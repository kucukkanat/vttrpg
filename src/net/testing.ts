/**
 * In-memory stand-in for SimplePool. A `FakeRelay` behaves like one relay
 * that stores regular and replaceable events and drops ephemeral ones after
 * delivery; each client gets its own `FakePool` on top of it. It can be told to
 * deliver stored events out of order or live events twice.
 * Used by the unit tests and the dev harness; never by the app.
 */
import { matchFilter, type Event as NostrEvent, type Filter } from 'nostr-tools'
import { normalizeURL } from 'nostr-tools/utils'
import type { SubCloser, SubscribeManyParams } from 'nostr-tools/abstract-pool'
import type { PoolLike } from './pool'

export interface FakeRelayOptions {
  /** Order in which stored events are replayed to a new subscription. */
  replayOrder?: 'stored' | 'reverse' | 'shuffle'
  /** Deliver every live event this many times (relays and multi-relay pools duplicate). */
  liveCopies?: number
  /** Deliver asynchronously (like a socket) instead of inside `publish`. */
  async?: boolean
}

interface LiveSub {
  filter: Filter
  params: SubscribeManyParams
  closed: boolean
}

const isEphemeral = (kind: number) => kind >= 20000 && kind < 30000
const isReplaceable = (kind: number) => (kind >= 30000 && kind < 40000) || (kind >= 10000 && kind < 20000) || kind === 0 || kind === 3
const dTag = (ev: NostrEvent) => ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''

export class FakeRelay {
  stored: NostrEvent[] = []
  published: NostrEvent[] = []
  subs: LiveSub[] = []

  constructor(readonly opts: FakeRelayOptions = {}) {}

  private store(ev: NostrEvent) {
    if (isEphemeral(ev.kind)) return
    if (isReplaceable(ev.kind)) {
      this.stored = this.stored.filter((e) => !(e.kind === ev.kind && e.pubkey === ev.pubkey && dTag(e) === dTag(ev)))
    }
    this.stored.push(ev)
  }

  private deliver(sub: LiveSub, ev: NostrEvent) {
    if (sub.closed || !matchFilter(sub.filter, ev)) return
    sub.params.onevent?.(ev)
  }

  /** Injects an event as if a client had published it to the relay. */
  inject(ev: NostrEvent) {
    this.store(ev)
    const copies = this.opts.liveCopies ?? 1
    const go = () => {
      for (const sub of [...this.subs]) for (let i = 0; i < copies; i++) this.deliver(sub, ev)
    }
    if (this.opts.async) queueMicrotask(go)
    else go()
  }

  replayList(filter: Filter): NostrEvent[] {
    const list = this.stored.filter((e) => matchFilter(filter, e))
    if (this.opts.replayOrder === 'reverse') list.reverse()
    if (this.opts.replayOrder === 'shuffle') {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[list[i], list[j]] = [list[j], list[i]]
      }
    }
    return list
  }

  subscribe(filter: Filter, params: SubscribeManyParams): LiveSub {
    const sub: LiveSub = { filter, params, closed: false }
    this.subs.push(sub)
    const go = () => {
      for (const ev of this.replayList(filter)) this.deliver(sub, ev)
      if (!sub.closed) params.oneose?.()
    }
    if (this.opts.async) queueMicrotask(go)
    else go()
    return sub
  }

  unsubscribe(sub: LiveSub) {
    sub.closed = true
    this.subs = this.subs.filter((s) => s !== sub)
  }
}

export class FakePool implements PoolLike {
  private mine: LiveSub[] = []
  connected = new Map<string, boolean>()
  destroyed = false
  private openListeners = new Set<(url: string) => void>()

  constructor(readonly relay: FakeRelay = new FakeRelay()) {}

  publish(_relays: string[], event: NostrEvent): Promise<string>[] {
    this.relay.published.push(event)
    this.relay.inject(event)
    return [Promise.resolve('ok')]
  }

  subscribeMany(_relays: string[], filter: Filter, params: SubscribeManyParams): SubCloser {
    const sub = this.relay.subscribe(filter, params)
    this.mine.push(sub)
    return { close: () => this.relay.unsubscribe(sub) }
  }

  async querySync(_relays: string[], filter: Filter): Promise<NostrEvent[]> {
    return this.relay.replayList(filter)
  }

  listConnectionStatus(): Map<string, boolean> {
    return new Map(this.connected)
  }

  onOpen(cb: (url: string) => void): () => void {
    this.openListeners.add(cb)
    return () => void this.openListeners.delete(cb)
  }

  /** Marks a relay open and tells listeners, as the real pool does when a socket connects. */
  emitOpen(url: string) {
    url = normalizeURL(url)
    this.connected.set(url, true)
    for (const cb of this.openListeners) cb(url)
  }

  destroy() {
    this.destroyed = true
    for (const s of this.mine) this.relay.unsubscribe(s)
    this.mine = []
  }
}
