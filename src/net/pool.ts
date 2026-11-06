/**
 * Thin seam over nostr-tools' SimplePool so the connection logic can be unit
 * tested with a fake, plus the relay status tracker behind `connection.status`.
 */
import { SimplePool, verifyEvent, type Event as NostrEvent, type Filter } from 'nostr-tools'
import type { SubCloser, SubscribeManyParams } from 'nostr-tools/abstract-pool'
import type { GameConnection } from './index'

export type Status = GameConnection['status']

export interface PoolLike {
  subscribeMany(relays: string[], filter: Filter, params: SubscribeManyParams): SubCloser
  querySync(relays: string[], filter: Filter, params?: { maxWait?: number }): Promise<NostrEvent[]>
  publish(relays: string[], event: NostrEvent): Promise<string>[]
  listConnectionStatus(): Map<string, boolean>
  destroy(): void
}

/**
 * `connecting` until one relay is open, `connected` while at least one is,
 * `offline` once every relay has dropped or every initial attempt failed.
 * SimplePool reconnects with backoff on its own; we only observe.
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
    this.failed.add(url)
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

export function createPool(relays: string[]): { pool: PoolLike; tracker: StatusTracker } {
  const tracker = new StatusTracker(relays)
  // SimplePool's constructor only takes the ping/reconnect flags; the rest are public fields.
  const pool = new SimplePool({ enableReconnect: true, enablePing: true })
  pool.verifyEvent = verifyEvent
  pool.maxWaitForConnection = 6000
  pool.onRelayConnectionSuccess = (url: string) => tracker.success(url)
  pool.onRelayConnectionFailure = (url: string) => tracker.failure(url)
  tracker.attach(pool)
  return { pool, tracker }
}
