import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SubscriptionParams } from 'nostr-tools/abstract-relay'
import { RelayPool, StatusTracker, backoffMs, createPool, type RelayLike } from './pool'

/** Scripted relay: `plan` says, per connect attempt, whether it opens ('ok'), fails ('fail') or hangs ('hang'). */
class ScriptedRelay implements RelayLike {
  connected = false
  onclose: (() => void) | null = null
  subs: { filters: Filter[]; params: SubscriptionParams; closed: boolean }[] = []
  published: NostrEvent[] = []
  constructor(readonly url: string, private readonly outcome: 'ok' | 'fail' | 'hang') {}
  connect(opts?: { timeout?: number }): Promise<void> {
    if (this.outcome === 'ok') {
      this.connected = true
      return Promise.resolve()
    }
    if (this.outcome === 'fail') return Promise.reject(new Error('refused'))
    return new Promise((_, reject) => setTimeout(() => reject(new Error('connection timed out')), opts?.timeout ?? 1000))
  }
  subscribe(filters: Filter[], params: SubscriptionParams) {
    const s = { filters, params, closed: false }
    this.subs.push(s)
    return { close: () => void (s.closed = true) }
  }
  publish(event: NostrEvent): Promise<string> {
    this.published.push(event)
    return Promise.resolve('ok')
  }
  close() {
    this.connected = false
  }
  /** Simulates the socket dropping. */
  drop() {
    this.connected = false
    this.onclose?.()
  }
  eoseAll() {
    for (const s of this.subs) s.params.oneose?.()
  }
}

function scripted(plans: Record<string, ('ok' | 'fail' | 'hang')[]>) {
  const created: ScriptedRelay[] = []
  const attempts: Record<string, number> = {}
  const createRelay = (url: string) => {
    const key = Object.keys(plans).find((k) => url.startsWith(k)) ?? url
    const n = attempts[key] ?? 0
    attempts[key] = n + 1
    const plan = plans[key] ?? ['ok']
    const r = new ScriptedRelay(url, plan[Math.min(n, plan.length - 1)])
    created.push(r)
    return r
  }
  return { created, attempts, createRelay }
}

const A = 'wss://a.test'
const B = 'wss://b.test'
const ev = (id: string, created_at = 1): NostrEvent => ({ id, kind: 1, created_at, tags: [], content: '', pubkey: 'p', sig: 's' })

let pools: RelayPool[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const p of pools) p.destroy()
  pools = []
  vi.useRealTimers()
})
const make = (opts: ConstructorParameters<typeof RelayPool>[0]) => {
  const p = new RelayPool({ random: () => 0.5, ...opts })
  pools.push(p)
  return p
}

describe('backoffMs', () => {
  it('doubles from the base and caps at the maximum', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffMs(n))).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000])
    expect(backoffMs(40)).toBe(60_000)
    expect(backoffMs(2, 500, 1500)).toBe(1500)
  })
})

describe('RelayPool', () => {
  it('retries a failed relay with exponential backoff and one attempt at a time', async () => {
    const s = scripted({ [A]: ['fail', 'fail', 'fail', 'ok'] })
    const pool = make({ relays: [A], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.attempts[A]).toBe(1)
    expect(pool.listConnectionStatus().get(A + '/')).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(s.attempts[A]).toBe(1) // still waiting out the 1s backoff
    await vi.advanceTimersByTimeAsync(1)
    expect(s.attempts[A]).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.attempts[A]).toBe(3)
    await vi.advanceTimersByTimeAsync(4000)
    expect(s.attempts[A]).toBe(4)
    expect(pool.openCount).toBe(1)
    // No further attempts once open.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.attempts[A]).toBe(4)
  })

  it('treats a hanging connect as a failure after the timeout and backs off', async () => {
    const s = scripted({ [A]: ['hang', 'ok'] })
    const pool = make({ relays: [A], createRelay: s.createRelay, connectTimeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(4999)
    expect(s.attempts[A]).toBe(1)
    await vi.advanceTimersByTimeAsync(1 + 1000)
    expect(s.attempts[A]).toBe(2)
    expect(pool.openCount).toBe(1)
  })

  it('reconnects after a drop with a reset backoff and re-attaches subscriptions with since', async () => {
    const s = scripted({ [A]: ['ok'] })
    const pool = make({ relays: [A], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    const got: string[] = []
    pool.subscribeMany([A], { kinds: [1] }, { onevent: (e) => got.push(e.id) })
    const first = s.created[0]
    expect(first.subs).toHaveLength(1)
    first.subs[0].params.onevent?.(ev('e1', 100))
    first.drop()
    expect(pool.openCount).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.attempts[A]).toBe(2)
    const second = s.created[1]
    expect(second.subs).toHaveLength(1)
    expect(second.subs[0].filters[0]).toEqual({ kinds: [1], since: 101 })
    expect(got).toEqual(['e1'])
  })

  it('attaches subscriptions made while a relay was down once it comes up', async () => {
    const s = scripted({ [A]: ['fail', 'ok'] })
    const pool = make({ relays: [A], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    const eose = vi.fn()
    pool.subscribeMany([A], { kinds: [1] }, { onevent: () => {}, oneose: eose, maxWait: 3000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.created[1].subs).toHaveLength(1)
    expect(s.created[1].subs[0].filters[0]).toEqual({ kinds: [1] })
    // A relay that only came up later does not count towards EOSE; the fallback timer fires it.
    await vi.advanceTimersByTimeAsync(2000)
    expect(eose).toHaveBeenCalledTimes(1)
  })

  it('fires oneose once every relay open at subscribe time has answered', async () => {
    const s = scripted({ [A]: ['ok'], [B]: ['ok'] })
    const pool = make({ relays: [A, B], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    const eose = vi.fn()
    pool.subscribeMany([A, B], { kinds: [1] }, { onevent: () => {}, oneose: eose })
    s.created[0].eoseAll()
    expect(eose).not.toHaveBeenCalled()
    s.created[1].eoseAll()
    expect(eose).toHaveBeenCalledTimes(1)
    s.created[1].eoseAll()
    expect(eose).toHaveBeenCalledTimes(1)
  })

  it('publishes to open relays only and rejects the rest immediately', async () => {
    const s = scripted({ [A]: ['ok'], [B]: ['fail'] })
    const pool = make({ relays: [A, B], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    const results = await Promise.allSettled(pool.publish([A, B], ev('x')))
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(s.created[0].published).toHaveLength(1)
    // No new socket was opened just to publish.
    expect(s.attempts[B]).toBe(1)
  })

  it('querySync resolves on EOSE with deduplicated events, or at maxWait', async () => {
    const s = scripted({ [A]: ['ok'], [B]: ['hang'] })
    const pool = make({ relays: [A, B], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    const q = pool.querySync([A, B], { kinds: [1] }, { maxWait: 2000 })
    const sub = s.created[0].subs[0]
    sub.params.onevent?.(ev('e1'))
    sub.params.onevent?.(ev('e1'))
    sub.params.oneose?.()
    expect((await q).map((e) => e.id)).toEqual(['e1'])

    const q2 = pool.querySync([B], { kinds: [1] }, { maxWait: 2000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await q2).toEqual([])
  })

  it('destroy stops reconnect timers and closes sockets', async () => {
    const s = scripted({ [A]: ['fail'], [B]: ['ok'] })
    const pool = make({ relays: [A, B], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    pool.destroy()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(s.attempts[A]).toBe(1)
    expect(s.created[1].connected).toBe(false)
  })

  it('reconnect retries every down relay at once with a fresh backoff and leaves open ones alone', async () => {
    const s = scripted({ [A]: ['fail', 'fail', 'fail', 'ok'], [B]: ['ok'] })
    const pool = make({ relays: [A, B], createRelay: s.createRelay })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000) // second attempt fails; now waiting out a 2 s backoff
    expect(s.attempts[A]).toBe(2)
    expect(s.attempts[B]).toBe(1)
    pool.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.attempts[A]).toBe(3) // did not wait the 2 s
    expect(s.attempts[B]).toBe(1) // open: untouched
    // That attempt failed too; the backoff restarted from the base (1 s), not 4 s.
    await vi.advanceTimersByTimeAsync(999)
    expect(s.attempts[A]).toBe(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(s.attempts[A]).toBe(4)
    expect(pool.openCount).toBe(2)
    pool.reconnect() // nothing down: no new attempts
    await vi.advanceTimersByTimeAsync(0)
    expect(s.attempts[A]).toBe(4)
  })
})

describe('StatusTracker over RelayPool', () => {
  it('is connected while any relay is open, offline when all drop, connected again on reconnect', async () => {
    const s = scripted({ [A]: ['ok', 'ok'], [B]: ['fail'] })
    const tracker = new StatusTracker([A, B], 0)
    const pool = make({ relays: [A, B], createRelay: s.createRelay })
    pool.onOpen((u) => tracker.success(u))
    pool.onClose(() => tracker.recompute())
    pool.onFail((u) => tracker.failure(u))
    tracker.attach(pool)
    const seen: string[] = []
    tracker.onChange((st) => seen.push(st))
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.status).toBe('connected')
    s.created[0].drop()
    expect(tracker.status).toBe('offline')
    await vi.advanceTimersByTimeAsync(1000)
    expect(tracker.status).toBe('connected')
    expect(seen).toEqual(['connected', 'offline', 'connected'])
    tracker.dispose()
  })

  it('reports offline when every initial attempt failed, then connected when one comes up', async () => {
    const s = scripted({ [A]: ['fail', 'ok'], [B]: ['fail', 'fail', 'fail'] })
    const { pool, tracker } = createPool([A, B])
    pools.push(pool)
    // createPool uses the real relay factory; drive a second pool with the scripted one for the status checks.
    pool.destroy()
    const p2 = make({ relays: [A, B], createRelay: s.createRelay })
    const t2 = new StatusTracker([A, B], 0)
    p2.onOpen((u) => t2.success(u))
    p2.onFail((u) => t2.failure(u))
    t2.attach(p2)
    await vi.advanceTimersByTimeAsync(0)
    expect(t2.status).toBe('offline')
    await vi.advanceTimersByTimeAsync(1000)
    expect(t2.status).toBe('connected')
    tracker.dispose()
    t2.dispose()
  })
})
