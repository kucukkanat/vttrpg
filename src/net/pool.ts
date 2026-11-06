/**
 * Relay pool with explicit connection management, replacing SimplePool.
 *
 * SimplePool re-creates a socket for every publish/subscribe to a relay that is
 * not connected and never retries a relay whose first connect failed, which on
 * flaky public relays turns into a storm of half-open sockets (presence publishes
 * ten times a second). Here each relay has one connection attempt at a time,
 * exponential backoff between attempts, and subscriptions are (re)attached when
 * it opens. Publishes only go to open relays; the rest reject at once.
 *
 * `PoolLike` is the seam the connection logic uses, so tests can drive a fake.
 */
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { Relay } from 'nostr-tools/relay'
import type { SubCloser, SubscribeManyParams } from 'nostr-tools/abstract-pool'
import type { SubscriptionParams } from 'nostr-tools/abstract-relay'
import { normalizeURL } from 'nostr-tools/utils'
import type { GameConnection } from './index'

export type Status = GameConnection['status']

export interface PoolLike {
  subscribeMany(relays: string[], filter: Filter, params: SubscribeManyParams): SubCloser
  querySync(relays: string[], filter: Filter, params?: { maxWait?: number }): Promise<NostrEvent[]>
  publish(relays: string[], event: NostrEvent): Promise<string>[]
  listConnectionStatus(): Map<string, boolean>
  /** Fires with the relay URL whenever a relay socket opens. Optional for fakes. */
  onOpen?(cb: (url: string) => void): () => void
  /** Retry every relay that is down right now, skipping the rest of its backoff. Optional for fakes. */
  reconnect?(): void
  destroy(): void
}

// --- backoff ------------------------------------------------------------------

export const BACKOFF_BASE_MS = 1000
export const BACKOFF_MAX_MS = 60_000
export const CONNECT_TIMEOUT_MS = 20_000

/** Exponential backoff for the n-th failed attempt (0-based): 1s, 2s, 4s ... capped. */
export function backoffMs(attempt: number, base = BACKOFF_BASE_MS, max = BACKOFF_MAX_MS): number {
  const n = Math.max(0, Math.floor(attempt))
  return Math.min(max, base * 2 ** Math.min(n, 30))
}

// --- relay seam ---------------------------------------------------------------------

/** The slice of nostr-tools' Relay the pool uses; tests inject fakes. */
export interface RelayLike {
  readonly url: string
  readonly connected: boolean
  onclose: (() => void) | null
  connect(opts?: { timeout?: number }): Promise<void>
  subscribe(filters: Filter[], params: SubscriptionParams): { close(reason?: string): void }
  publish(event: NostrEvent): Promise<string>
  close(): void
}

export function createNostrRelay(url: string): RelayLike {
  // No built-in ping (its dummy REQ closes sockets on relays that answer slowly) and no built-in
  // reconnect: the pool schedules reconnects with backoff itself.
  return new Relay(url, { enablePing: false, enableReconnect: false }) as unknown as RelayLike
}

export interface RelayPoolOptions {
  relays: string[]
  createRelay?: (url: string) => RelayLike
  connectTimeoutMs?: number
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** Jitter source in [0, 1); defaults to Math.random. */
  random?: () => number
  /** Fire `oneose` for a subscription with no open relay at the latest after this long. */
  eoseFallbackMs?: number
  log?: (...args: unknown[]) => void
}

interface RelayRecord {
  url: string
  relay: RelayLike | null
  state: 'idle' | 'connecting' | 'open' | 'down'
  attempts: number
  timer: ReturnType<typeof setTimeout> | undefined
  generation: number
}

interface SubRecord {
  id: number
  relays: Set<string>
  filter: Filter
  params: SubscribeManyParams
  per: Map<string, { close(reason?: string): void }>
  /** Relays attached at subscribe time that have not sent EOSE yet. */
  awaitingEose: Set<string>
  eosed: boolean
  eoseTimer: ReturnType<typeof setTimeout> | undefined
  lastEmitted: number
  closed: boolean
}

export class RelayPool implements PoolLike {
  private readonly records = new Map<string, RelayRecord>()
  private readonly subs = new Map<number, SubRecord>()
  private readonly openListeners = new Set<(url: string) => void>()
  private readonly closeListeners = new Set<(url: string) => void>()
  private readonly failListeners = new Set<(url: string) => void>()
  private nextSubId = 1
  private destroyed = false
  private readonly createRelay: (url: string) => RelayLike
  private readonly connectTimeoutMs: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly random: () => number
  private readonly eoseFallbackMs: number
  private readonly log: (...args: unknown[]) => void

  constructor(opts: RelayPoolOptions) {
    this.createRelay = opts.createRelay ?? createNostrRelay
    this.connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.backoffBaseMs = opts.backoffBaseMs ?? BACKOFF_BASE_MS
    this.backoffMaxMs = opts.backoffMaxMs ?? BACKOFF_MAX_MS
    this.random = opts.random ?? Math.random
    this.eoseFallbackMs = opts.eoseFallbackMs ?? 10_000
    this.log = opts.log ?? (() => {})
    for (const raw of opts.relays) {
      const url = normalizeURL(raw)
      if (!this.records.has(url)) this.records.set(url, { url, relay: null, state: 'idle', attempts: 0, timer: undefined, generation: 0 })
    }
    for (const rec of this.records.values()) this.connect(rec)
  }

  get urls(): string[] {
    return [...this.records.keys()]
  }

  // --- connections ------------------------------------------------------------------

  private connect(rec: RelayRecord) {
    if (this.destroyed || rec.state === 'connecting' || rec.state === 'open') return
    rec.state = 'connecting'
    rec.timer = undefined
    const generation = ++rec.generation
    const relay = this.createRelay(rec.url)
    rec.relay = relay
    relay.onclose = () => {
      if (rec.generation !== generation) return
      this.handleDown(rec, 'closed')
    }
    relay.connect({ timeout: this.connectTimeoutMs }).then(
      () => {
        if (rec.generation !== generation || this.destroyed) return
        rec.state = 'open'
        rec.attempts = 0
        this.log('net: relay open', rec.url)
        for (const sub of this.subs.values()) this.attach(sub, rec, false)
        for (const cb of this.openListeners) cb(rec.url)
      },
      (e: unknown) => {
        if (rec.generation !== generation) return
        this.handleDown(rec, `connect failed: ${String(e)}`)
      },
    )
  }

  private handleDown(rec: RelayRecord, reason: string) {
    if (rec.state === 'down' || rec.state === 'idle') return
    const wasOpen = rec.state === 'open'
    rec.state = 'down'
    rec.relay = null
    for (const sub of this.subs.values()) {
      sub.per.delete(rec.url)
      if (sub.awaitingEose.delete(rec.url)) this.checkEose(sub)
    }
    if (wasOpen) for (const cb of this.closeListeners) cb(rec.url)
    else for (const cb of this.failListeners) cb(rec.url)
    if (this.destroyed) return
    const delay = backoffMs(rec.attempts, this.backoffBaseMs, this.backoffMaxMs)
    const jitter = 1 + (this.random() - 0.5) * 0.4
    rec.attempts++
    this.log('net: relay down', rec.url, reason, `retry in ${Math.round(delay / 1000)}s`)
    rec.timer = setTimeout(() => this.connect(rec), Math.round(delay * jitter))
  }

  /**
   * User-driven retry (the Offline banner): every relay waiting out a backoff connects now, with
   * its attempt counter reset so the next failure starts the backoff from the base again.
   * Relays that are connecting or open are left alone.
   */
  reconnect() {
    if (this.destroyed) return
    for (const rec of this.records.values()) {
      if (rec.state !== 'down') continue
      if (rec.timer) clearTimeout(rec.timer)
      rec.timer = undefined
      rec.attempts = 0
      this.log('net: relay retry now', rec.url)
      this.connect(rec)
    }
  }

  // --- subscriptions ------------------------------------------------------------------

  /** Sends the REQ to one open relay. `initial` relays count towards the subscription's EOSE. */
  private attach(sub: SubRecord, rec: RelayRecord, initial: boolean) {
    if (sub.closed || !rec.relay || rec.state !== 'open' || !sub.relays.has(rec.url) || sub.per.has(rec.url)) return
    // A relay that comes back after a drop only needs what we have not seen yet.
    const filter: Filter = !initial && sub.lastEmitted > 0 ? { ...sub.filter, since: sub.lastEmitted + 1 } : sub.filter
    if (initial) sub.awaitingEose.add(rec.url)
    const handle = rec.relay.subscribe([filter], {
      onevent: (ev) => {
        if (sub.closed) return
        sub.lastEmitted = Math.max(sub.lastEmitted, ev.created_at)
        sub.params.onevent?.(ev)
      },
      oneose: () => {
        if (sub.awaitingEose.delete(rec.url)) this.checkEose(sub)
      },
      eoseTimeout: sub.params.maxWait,
    })
    sub.per.set(rec.url, handle)
  }

  private checkEose(sub: SubRecord) {
    if (sub.eosed || sub.closed || sub.awaitingEose.size > 0) return
    sub.eosed = true
    if (sub.eoseTimer) clearTimeout(sub.eoseTimer)
    sub.params.oneose?.()
  }

  subscribeMany(relays: string[], filter: Filter, params: SubscribeManyParams): SubCloser {
    const sub: SubRecord = {
      id: this.nextSubId++,
      relays: new Set(relays.map(normalizeURL)),
      filter,
      params,
      per: new Map(),
      awaitingEose: new Set(),
      eosed: false,
      eoseTimer: undefined,
      lastEmitted: 0,
      closed: false,
    }
    this.subs.set(sub.id, sub)
    for (const rec of this.records.values()) this.attach(sub, rec, true)
    if (sub.awaitingEose.size === 0) {
      // Nothing is open yet: give the relays a moment to come up before declaring the replay done.
      sub.eoseTimer = setTimeout(() => this.checkEose(sub), params.maxWait ?? this.eoseFallbackMs)
    }
    return {
      close: () => {
        if (sub.closed) return
        sub.closed = true
        if (sub.eoseTimer) clearTimeout(sub.eoseTimer)
        for (const h of sub.per.values()) {
          try {
            h.close()
          } catch {
            // socket already gone
          }
        }
        sub.per.clear()
        this.subs.delete(sub.id)
      },
    }
  }

  querySync(relays: string[], filter: Filter, params: { maxWait?: number } = {}): Promise<NostrEvent[]> {
    const maxWait = params.maxWait ?? 6000
    return new Promise((resolve) => {
      const events: NostrEvent[] = []
      const seen = new Set<string>()
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        sub.close()
        resolve(events)
      }
      const timer = setTimeout(finish, maxWait)
      const sub = this.subscribeMany(relays, filter, {
        maxWait,
        onevent: (ev) => {
          if (seen.has(ev.id)) return
          seen.add(ev.id)
          events.push(ev)
        },
        oneose: finish,
      })
    })
  }

  // --- publishing -------------------------------------------------------------------------

  publish(relays: string[], event: NostrEvent): Promise<string>[] {
    return relays.map((raw) => {
      const url = normalizeURL(raw)
      const rec = this.records.get(url)
      if (!rec || rec.state !== 'open' || !rec.relay) return Promise.reject(new Error(`${url}: not connected`))
      return rec.relay.publish(event)
    })
  }

  // --- status -----------------------------------------------------------------------------

  listConnectionStatus(): Map<string, boolean> {
    const m = new Map<string, boolean>()
    for (const rec of this.records.values()) m.set(rec.url, rec.state === 'open')
    return m
  }

  get openCount(): number {
    let n = 0
    for (const rec of this.records.values()) if (rec.state === 'open') n++
    return n
  }

  onOpen(cb: (url: string) => void): () => void {
    this.openListeners.add(cb)
    return () => void this.openListeners.delete(cb)
  }

  onClose(cb: (url: string) => void): () => void {
    this.closeListeners.add(cb)
    return () => void this.closeListeners.delete(cb)
  }

  onFail(cb: (url: string) => void): () => void {
    this.failListeners.add(cb)
    return () => void this.failListeners.delete(cb)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const sub of [...this.subs.values()]) {
      sub.closed = true
      if (sub.eoseTimer) clearTimeout(sub.eoseTimer)
    }
    this.subs.clear()
    for (const rec of this.records.values()) {
      if (rec.timer) clearTimeout(rec.timer)
      rec.generation++
      const relay = rec.relay
      rec.relay = null
      rec.state = 'idle'
      if (relay) {
        relay.onclose = null
        try {
          relay.close()
        } catch {
          // already closed
        }
      }
    }
    this.openListeners.clear()
    this.closeListeners.clear()
    this.failListeners.clear()
  }
}

// --- status tracker ---------------------------------------------------------------------------

/**
 * `connecting` until one relay is open, `connected` while at least one is,
 * `offline` once every relay has dropped or every initial attempt failed.
 * Reconnection is the pool's job; the tracker only observes.
 */
export class StatusTracker {
  private _status: Status = 'connecting'
  private everConnected = false
  private failed = new Set<string>()
  private listeners = new Set<(s: Status) => void>()
  private timer: ReturnType<typeof setInterval> | undefined
  private pool: PoolLike | null = null

  constructor(private readonly relays: string[], pollMs = 2000) {
    if (pollMs > 0) this.timer = setInterval(() => this.recompute(), pollMs)
  }

  attach(pool: PoolLike) {
    this.pool = pool
    this.recompute()
  }

  get status(): Status {
    return this._status
  }

  onChange(cb: (s: Status) => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  success(_url: string) {
    this.everConnected = true
    this.recompute()
  }

  failure(url: string) {
    this.failed.add(normalizeURL(url))
    this.recompute()
  }

  recompute() {
    let open = 0
    if (this.pool) for (const v of this.pool.listConnectionStatus().values()) if (v) open++
    let next: Status
    if (open > 0) {
      this.everConnected = true
      next = 'connected'
    } else if (this.everConnected || this.failed.size >= this.relays.length) {
      next = 'offline'
    } else {
      next = 'connecting'
    }
    if (next !== this._status) {
      this._status = next
      for (const cb of this.listeners) cb(next)
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.listeners.clear()
    this.pool = null
  }
}

export function createPool(relays: string[], log?: (...args: unknown[]) => void): { pool: RelayPool; tracker: StatusTracker } {
  const tracker = new StatusTracker(relays.map(normalizeURL))
  const pool = new RelayPool({ relays, log })
  pool.onOpen((url) => tracker.success(url))
  pool.onClose(() => tracker.recompute())
  pool.onFail((url) => tracker.failure(url))
  tracker.attach(pool)
  return { pool, tracker }
}
