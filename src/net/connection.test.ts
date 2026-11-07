import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { generateSecretKey } from 'nostr-tools'
import type { GameId } from '@/core/ids'
import type { IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { GameConnection } from './index'
import { CHUNK_BYTES, KIND_DELTA, KIND_INTENT, KIND_MANIFEST, KIND_PRESENCE, randomGameKey, sha256Hex, tagValue, type Manifest } from './codec'
import { normalizeURL } from 'nostr-tools/utils'
import { DELTA_COALESCE_MS, REMOTE_ORIGIN, fetchManifest, openConnection, readManifest } from './connection'
import { localIdentity } from './identity'
import { StatusTracker } from './pool'
import { FakePool, FakeRelay, type FakeRelayOptions } from './testing'
import { createMemoryGameStore } from './localStore'
import { encryptBlob, newBlobKey } from '@/core/blobCrypto'

const RELAYS = ['wss://fake.one', 'wss://fake.two']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tracker = () => new StatusTracker(RELAYS, 0)

async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await sleep(5)
  }
}

interface World {
  relay: FakeRelay
  gameId: GameId
  gameKey: Uint8Array
  gm: GameConnection
  open: GameConnection[]
}

async function createWorld(relayOpts: FakeRelayOptions = {}): Promise<World> {
  const relay = new FakeRelay(relayOpts)
  const identity = localIdentity(generateSecretKey())
  const gameId = crypto.randomUUID() as GameId
  const gameKey = randomGameKey()
  const manifest: Manifest = { name: 'Test game', gm: identity.pubkey, relays: RELAYS }
  const pool = new FakePool(relay)
  const gm = await openConnection({ relays: RELAYS, identity, gameId, gameKey, isGm: true, pool, tracker: tracker(), manifest, fresh: true })
  return { relay, gameId, gameKey, gm, open: [gm] }
}

async function join(w: World, extra: { isGm?: boolean; fetchImpl?: typeof fetch; replayTimeoutMs?: number } = {}) {
  const identity = localIdentity(generateSecretKey())
  const pool = new FakePool(w.relay)
  const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
  const conn = await openConnection({
    relays: RELAYS,
    identity,
    gameId: w.gameId,
    gameKey: w.gameKey,
    isGm: extra.isGm ?? false,
    pool,
    tracker: tracker(),
    manifest,
    fetchImpl: extra.fetchImpl,
    replayTimeoutMs: extra.replayTimeoutMs,
  })
  w.open.push(conn)
  return { conn, identity }
}

/** Waits for the GM's coalescing window plus delivery. */
const settle = () => sleep(DELTA_COALESCE_MS * 3)

let worlds: World[] = []
afterEach(() => {
  for (const w of worlds) for (const c of w.open) c.close()
  worlds = []
})
const world = async (o?: FakeRelayOptions) => {
  const w = await createWorld(o)
  worlds.push(w)
  return w
}

describe('local copy', () => {
  it('GM: a game created while no relay accepts anything survives a reload from the local copy and is published on connect', async () => {
    class DeadPool extends FakePool {
      override publish(_relays: string[], event: Parameters<FakePool['publish']>[1]): Promise<string>[] {
        this.relay.published.push(event)
        return [Promise.reject(new Error('down')), Promise.reject(new Error('down'))]
      }
    }
    const relay = new FakeRelay()
    const local = createMemoryGameStore()
    const identity = localIdentity(generateSecretKey())
    const gameId = crypto.randomUUID() as GameId
    const gameKey = randomGameKey()
    const manifest: Manifest = { name: 'Offline', gm: identity.pubkey, relays: RELAYS }
    const log = vi.fn()
    const first = await openConnection({ relays: RELAYS, identity, gameId, gameKey, isGm: true, pool: new DeadPool(relay), tracker: tracker(), manifest, fresh: true, local, log, manifestWaitMs: 30 })
    expect(relay.stored.filter((e) => e.kind === KIND_MANIFEST)).toHaveLength(0)
    first.doc.getMap('meta').set('gm', identity.pubkey)
    first.doc.getMap('tokens').set('t1', { hp: 3 })
    await sleep(DELTA_COALESCE_MS * 2)
    first.close() // flushes the pending local save
    const saved = await local.load(gameId)
    expect(saved?.manifest?.name).toBe('Offline')
    expect(saved?.update).toBeDefined()

    // New tab, same GM, relays reachable now: open from the local copy without asking the relays.
    const pool = new FakePool(relay)
    const back = await openConnection({ relays: RELAYS, identity, gameId, gameKey, isGm: true, pool, tracker: tracker(), manifest: saved!.manifest!, local, log, manifestSpreadMs: 0 })
    worlds.push({ relay, gameId, gameKey, gm: back, open: [back] })
    expect(back.hasLocalCopy).toBe(true)
    expect(back.isGm).toBe(true)
    expect(back.doc.getMap('tokens').get('t1')).toEqual({ hp: 3 })
    // A relay opening makes the GM publish the manifest there.
    pool.emitOpen(RELAYS[0])
    await until(() => relay.stored.some((e) => e.kind === KIND_MANIFEST))
    expect(readManifest(gameKey, gameId, relay.stored.find((e) => e.kind === KIND_MANIFEST)!)?.name).toBe('Offline')
  })

  it('player: rejoins from the local copy at once and catches up on deltas behind it', async () => {
    const w = await world()
    const local = createMemoryGameStore()
    w.gm.doc.getMap('meta').set('name', 'Test game')
    w.gm.doc.getMap('tokens').set('t1', { hp: 3 })
    await settle()
    const identity = localIdentity(generateSecretKey())
    const open = async () => {
      const pool = new FakePool(w.relay)
      const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
      const c = await openConnection({ relays: RELAYS, identity, gameId: w.gameId, gameKey: w.gameKey, isGm: false, pool, tracker: tracker(), manifest, local })
      w.open.push(c)
      return c
    }
    const p1 = await open()
    expect(p1.hasLocalCopy).toBe(false)
    expect(p1.doc.getMap('tokens').get('t1')).toEqual({ hp: 3 })
    await sleep(600) // debounce
    p1.close()
    expect((await local.load(w.gameId))?.update).toBeDefined()

    // The GM moves on while the player is away.
    w.gm.doc.getMap('tokens').set('t2', { hp: 1 })
    await settle()

    const p2 = await open()
    expect(p2.hasLocalCopy).toBe(true)
    expect(p2.doc.getMap('tokens').get('t1')).toEqual({ hp: 3 })
    await until(() => p2.doc.getMap('tokens').has('t2'))
  })
})

describe('manifest', () => {
  it('is republished by the GM to relays that come up after the first publish', async () => {
    class FlakyPool extends FakePool {
      down = new Set<string>()
      override publish(relays: string[], event: Parameters<FakePool['publish']>[1]): Promise<string>[] {
        this.relay.published.push(event)
        this.relay.inject(event)
        return relays.map((r) => (this.down.has(r) ? Promise.reject(new Error(`${r}: not connected`)) : Promise.resolve('ok')))
      }
    }
    const relay = new FakeRelay()
    const pool = new FlakyPool(relay)
    pool.down.add(RELAYS[1])
    pool.connected.set(normalizeURL(RELAYS[0]), true)
    const identity = localIdentity(generateSecretKey())
    const gameId = crypto.randomUUID() as GameId
    const gameKey = randomGameKey()
    const manifest: Manifest = { name: 'Spread', gm: identity.pubkey, relays: RELAYS }
    const gm = await openConnection({ relays: RELAYS, identity, gameId, gameKey, isGm: true, pool, tracker: tracker(), manifest, fresh: true, manifestSpreadMs: 40 })
    worlds.push({ relay, gameId, gameKey, gm, open: [gm] })
    const manifests = () => relay.published.filter((e) => e.kind === KIND_MANIFEST).length
    await sleep(100)
    expect(manifests()).toBe(1) // relay two is down and not open: nothing to do
    pool.down.delete(RELAYS[1])
    pool.connected.set(normalizeURL(RELAYS[1]), true)
    await until(() => manifests() === 2)
    await sleep(120)
    expect(manifests()).toBe(2) // both accepted now: no further republishing
  })

  it('is published encrypted on create and decrypts only with the game key', async () => {
    const w = await world()
    const ev = w.relay.stored.find((e) => e.kind === KIND_MANIFEST)!
    expect(ev).toBeDefined()
    expect(tagValue(ev.tags, 'd')).toBe(w.gameId)
    expect(tagValue(ev.tags, 't')).toBe('vttrpg')
    expect(ev.content).not.toContain('Test game')
    expect(readManifest(w.gameKey, w.gameId, ev)?.name).toBe('Test game')
    expect(readManifest(randomGameKey(), w.gameId, ev)).toBeNull()
    expect(w.gm.inviteLink()).toContain('#/join/naddr1')
  })

  it('fetchManifest rejects when nothing on the relays matches', async () => {
    const pool = new FakePool(new FakeRelay())
    await expect(fetchManifest(pool, RELAYS, randomGameKey(), 'nope' as GameId, 1100)).rejects.toThrow(/not found/)
  })
})

describe('delta transport', () => {
  it('syncs GM edits to a late joiner and then live', async () => {
    const w = await world()
    w.gm.doc.getMap('meta').set('name', 'Brambleburrow')
    w.gm.doc.getMap('tokens').set('t1', { x: 1 })
    await settle()
    expect(w.relay.stored.filter((e) => e.kind === KIND_DELTA).length).toBeGreaterThan(0)

    const { conn: player } = await join(w)
    expect(player.doc.getMap('meta').get('name')).toBe('Brambleburrow')
    expect(player.doc.getMap('tokens').get('t1')).toEqual({ x: 1 })
    expect(player.isGm).toBe(false)
    expect(player.gm).toBe(w.gm.gm)

    w.gm.doc.getMap('tokens').set('t2', { x: 2 })
    await settle()
    expect(player.doc.getMap('tokens').get('t2')).toEqual({ x: 2 })
  })

  it('applies replayed deltas in created_at order and drops duplicates', async () => {
    const w = await world({ replayOrder: 'reverse', liveCopies: 2 })
    const sent: Uint8Array[] = []
    w.gm.doc.on('update', (u: Uint8Array) => sent.push(u))
    for (let i = 0; i < 4; i++) {
      w.gm.doc.getMap('m').set('k' + i, i)
      await settle()
    }
    // Make created_at strictly increasing so the order test is meaningful.
    const deltas = w.relay.stored.filter((e) => e.kind === KIND_DELTA)
    expect(deltas).toHaveLength(4)
    deltas.forEach((e, i) => (e.created_at = 1_700_000_000 + i))

    const { conn: player } = await join(w)
    const applied: Uint8Array[] = []
    player.doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) applied.push(u)
    })
    const applyCount = applied.length
    expect(player.doc.getMap('m').toJSON()).toEqual({ k0: 0, k1: 1, k2: 2, k3: 3 })

    // Live: relay delivers each event twice; it must be applied once.
    w.gm.doc.getMap('m').set('live', true)
    await settle()
    expect(applied.length - applyCount).toBe(1)
    expect(player.doc.getMap('m').get('live')).toBe(true)
  })

  it('replays in created_at order (observed through Yjs update events)', async () => {
    const w = await world({ replayOrder: 'reverse' })
    const text = w.gm.doc.getText('t')
    for (const ch of ['a', 'b', 'c']) {
      text.insert(text.length, ch)
      await settle()
    }
    const deltas = w.relay.stored.filter((e) => e.kind === KIND_DELTA)
    deltas.forEach((e, i) => (e.created_at = 1_700_000_000 + i))
    const relayOrder = w.relay.replayList({ kinds: [KIND_DELTA] }).map((e) => e.id)
    expect(relayOrder).toEqual([...deltas.map((e) => e.id)].reverse())

    const identity = localIdentity(generateSecretKey())
    const pool = new FakePool(w.relay)
    const seenOrder: string[] = []
    const origSubscribe = pool.subscribeMany.bind(pool)
    pool.subscribeMany = (relays, filter, params) =>
      origSubscribe(relays, filter, {
        ...params,
        onevent: (ev) => {
          if (ev.kind === KIND_DELTA) seenOrder.push(ev.id)
          params.onevent?.(ev)
        },
      })
    const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
    const player = await openConnection({ relays: RELAYS, identity, gameId: w.gameId, gameKey: w.gameKey, isGm: false, pool, tracker: tracker(), manifest })
    w.open.push(player)
    // The relay handed them over reversed, but the doc ends up intact with no pending structs.
    expect(seenOrder).toEqual(relayOrder)
    expect(player.doc.getText('t').toString()).toBe('abc')
    expect(player.doc.store.pendingStructs).toBeNull()
  })

  it('chunks big updates across events and reassembles them', async () => {
    const w = await world({ replayOrder: 'shuffle' })
    const blob = Array.from(crypto.getRandomValues(new Uint8Array(CHUNK_BYTES * 2 + 100)), (b) => String.fromCharCode(97 + (b % 26))).join('')
    w.gm.doc.getMap('big').set('blob', blob)
    await settle()
    const deltas = w.relay.stored.filter((e) => e.kind === KIND_DELTA)
    expect(deltas.length).toBe(3)
    expect(deltas.map((e) => tagValue(e.tags, 'chunk')).sort()).toEqual(['0/3', '1/3', '2/3'])
    expect(new Set(deltas.map((e) => tagValue(e.tags, 'batch'))).size).toBe(1)
    for (const e of deltas) expect(e.content.length).toBeLessThan(64 * 1024)

    const { conn: player } = await join(w)
    expect(player.doc.getMap('big').get('blob')).toBe(blob)
  })

  it('ignores deltas not signed by the GM', async () => {
    const w = await world()
    const { conn: player } = await join(w)
    const impostor = localIdentity(generateSecretKey())
    const forged = new Y.Doc()
    forged.getMap('meta').set('name', 'pwned')
    const update = Y.encodeStateAsUpdate(forged)
    const { encryptBytes, coordinate } = await import('./codec')
    const ev = (await impostor.sign({
      kind: KIND_DELTA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['a', coordinate(w.gm.gm, w.gameId)],
        ['g', w.gameId],
      ],
      content: encryptBytes(w.gameKey, update),
    })) as never
    w.relay.inject(ev)
    await settle()
    expect(player.doc.getMap('meta').get('name')).toBeUndefined()
  })

  it('players never publish deltas for local edits', async () => {
    const w = await world()
    const { conn: player } = await join(w)
    const before = w.relay.published.length
    player.doc.getMap('meta').set('optimistic', true)
    await settle()
    expect(w.relay.published.length).toBe(before)
  })
})

describe('intents', () => {
  it('reach the GM with the signer as sender; GM intents short-circuit locally', async () => {
    const w = await world({ liveCopies: 2 })
    const { conn: player, identity: playerId } = await join(w)
    const got: IntentEnvelope[] = []
    // Resolve on delivery instead of polling: the relay hands both live copies to the GM in the same
    // synchronous pass, so once the first one has been seen the dedupe of the second is already decided.
    let arrived!: () => void
    const delivered = new Promise<void>((r) => (arrived = r))
    w.gm.onIntent((i) => {
      got.push(i)
      arrived()
    })

    const env: IntentEnvelope = { id: 'i1', from: w.gm.gm, at: 1, intent: { type: 'chat.say', text: 'hi' } }
    player.sendIntent(env)
    await delivered
    expect(got).toHaveLength(1)
    expect(got[0].from).toBe(playerId.pubkey) // envelope lied; the signature wins
    expect(got[0].intent).toEqual({ type: 'chat.say', text: 'hi' })
    expect(w.relay.published.some((e) => e.kind === KIND_INTENT && !e.content.includes('hi'))).toBe(true)

    const before = w.relay.published.length
    w.gm.sendIntent({ id: 'i2', from: w.gm.gm, at: 2, intent: { type: 'fog.reset', scene: 's' as never } })
    expect(got).toHaveLength(2)
    expect(got[1].id).toBe('i2')
    expect(w.relay.published.length).toBe(before)
  })
})

describe('GM away', () => {
  const beacon = (c: GameConnection): Presence => ({ pubkey: c.gm, name: 'GM', color: '#fff', scene: null, lastSeen: 0 })
  /** A player whose connection calls the GM away after `gmAwayMs` of silence and drops queued intents after `ttl`. */
  async function joinPlayer(w: World, gmAwayMs: number, queueTtlMs: number) {
    const identity = localIdentity(generateSecretKey())
    const pool = new FakePool(w.relay)
    const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
    const conn = await openConnection({ relays: RELAYS, identity, gameId: w.gameId, gameKey: w.gameKey, isGm: false, pool, tracker: tracker(), manifest, gmAwayMs, queueTtlMs })
    w.open.push(conn)
    return { conn, identity }
  }
  const say = (text: string): IntentEnvelope => ({ id: crypto.randomUUID(), from: 'x' as never, at: 1, intent: { type: 'chat.say', text } })
  const roll = (): IntentEnvelope => ({ id: crypto.randomUUID(), from: 'x' as never, at: 1, intent: { type: 'roll', formula: 'd20', seed: 's' } })

  it('flags the GM away after silence, back on their next beacon, and never for the GM itself', async () => {
    const w = await world()
    // 250 ms of silence: well above the 100 ms presence throttle, so a beaconing GM stays present.
    const { conn: player } = await joinPlayer(w, 250, 10_000)
    const seen: boolean[] = []
    player.onGmAway((a) => seen.push(a))
    expect(player.gmAway).toBe(false)
    expect(w.gm.gmAway).toBe(false)
    await until(() => player.gmAway, 2000)
    expect(seen).toEqual([true])
    w.gm.publishPresence(beacon(w.gm))
    await until(() => !player.gmAway, 1500)
    expect(seen).toEqual([true, false])
    // A GM that keeps beaconing (throttled to one per 100 ms) never counts as away.
    for (let i = 0; i < 6; i++) {
      await sleep(60)
      w.gm.publishPresence(beacon(w.gm))
    }
    await sleep(0)
    expect(player.gmAway).toBe(false)
    expect(seen).toEqual([true, false])
    expect(w.gm.gmAway).toBe(false)
  })

  it('queues chat and own token moves while away, refuses rolls, and delivers the queue in order when the GM is back', async () => {
    const w = await world()
    const { conn: player, identity: playerId } = await joinPlayer(w, 150, 10_000)
    w.gm.publishPresence(beacon(w.gm)) // the GM is here while the doc settles
    // The player owns t1 in the doc; t2 belongs to nobody.
    w.gm.doc.getMap('tokens').set('t1', { owner: playerId.pubkey })
    w.gm.doc.getMap('tokens').set('t2', {})
    await settle()
    const got: IntentEnvelope[] = []
    w.gm.onIntent((i) => got.push(i))

    // Present: straight through.
    expect(player.gmAway).toBe(false)
    expect(player.sendIntent(say('hello'))).toEqual({ sent: true })
    await until(() => got.length === 1)

    await until(() => player.gmAway, 2000)
    const move = { id: 'm1', from: 'x' as never, at: 1, intent: { type: 'token.move', token: 't1' as never, position: { x: 1, y: 0, z: 1 } } } as IntentEnvelope
    const r1 = player.sendIntent(move)
    const r2 = player.sendIntent(say('while you were out'))
    expect(r1).toMatchObject({ queued: true })
    expect(r2).toMatchObject({ queued: true })
    expect(player.sendIntent(roll())).toEqual({ rejected: 'gm-away' })
    expect(player.sendIntent({ ...move, intent: { ...move.intent, token: 't2' as never } as never })).toEqual({ rejected: 'not-owner' })
    expect(player.sendIntent({ id: 'c', from: 'x' as never, at: 1, intent: { type: 'token.claim', token: 't2' as never } })).toEqual({ rejected: 'gm-away' })
    expect(player.queuedIntents).toBe(2)
    await sleep(60)
    expect(got).toHaveLength(1) // nothing left the device

    w.gm.publishPresence(beacon(w.gm))
    await until(() => got.length === 3)
    expect(got.slice(1).map((e) => e.intent.type)).toEqual(['token.move', 'chat.say'])
    expect(got.every((e) => e.from === playerId.pubkey)).toBe(true)
    expect(player.queuedIntents).toBe(0)
    expect(player.gmAway).toBe(false)
    if (!('queued' in r1) || !('queued' in r2)) throw new Error('expected queued results')
    await expect(Promise.all([r1.settled, r2.settled])).resolves.toEqual(['delivered', 'delivered'])
  })

  it('drops queued intents after the TTL and reports them as expired', async () => {
    const w = await world()
    const { conn: player } = await joinPlayer(w, 40, 80)
    const got: IntentEnvelope[] = []
    w.gm.onIntent((i) => got.push(i))
    await until(() => player.gmAway, 1500)
    const r = player.sendIntent(say('too late'))
    if (!('queued' in r)) throw new Error('expected a queued result')
    expect(player.queuedIntents).toBe(1)
    await expect(r.settled).resolves.toBe('expired')
    expect(player.queuedIntents).toBe(0)
    w.gm.publishPresence(beacon(w.gm))
    await sleep(60)
    expect(got).toHaveLength(0)
  })

  it('close expires whatever is still queued', async () => {
    const w = await world()
    const { conn: player } = await joinPlayer(w, 40, 10_000)
    await until(() => player.gmAway, 1500)
    const r = player.sendIntent(say('bye'))
    if (!('queued' in r)) throw new Error('expected a queued result')
    player.close()
    await expect(r.settled).resolves.toBe('expired')
    expect(player.sendIntent(say('after close'))).toEqual({ rejected: 'closed' })
  })
})

describe('presence', () => {
  const p = (name: string): Presence => ({ pubkey: 'x' as never, name, color: '#fff', scene: null, lastSeen: 0 })

  it('is throttled to 10 per second and delivered to others only', async () => {
    const w = await world()
    const { conn: player, identity: playerId } = await join(w)
    const gmGot: Presence[] = []
    const playerGot: Presence[] = []
    w.gm.onPresence((x) => gmGot.push(x))
    player.onPresence((x) => playerGot.push(x))

    for (let i = 0; i < 30; i++) player.publishPresence(p('p' + i))
    await sleep(250)
    const sent = w.relay.published.filter((e) => e.kind === KIND_PRESENCE)
    expect(sent.length).toBeGreaterThanOrEqual(1)
    expect(sent.length).toBeLessThanOrEqual(3)
    expect(gmGot.at(-1)?.name).toBe('p29')
    expect(gmGot.every((x) => x.pubkey === playerId.pubkey)).toBe(true)
    expect(playerGot).toHaveLength(0) // own presence is not echoed back

    // Steady state: sustained publishing yields at most ~10/s.
    const start = w.relay.published.filter((e) => e.kind === KIND_PRESENCE).length
    const t0 = Date.now()
    while (Date.now() - t0 < 500) {
      player.publishPresence(p('spam'))
      await sleep(5)
    }
    await sleep(120)
    const n = w.relay.published.filter((e) => e.kind === KIND_PRESENCE).length - start
    expect(n).toBeLessThanOrEqual(8)
    expect(n).toBeGreaterThanOrEqual(3)
  })
})

describe('snapshots', () => {
  const latestPointer = (w: World) => {
    const m = w.relay.stored.filter((e) => e.kind === KIND_MANIFEST).sort((a, b) => b.created_at - a.created_at)[0]
    return m ? readManifest(w.gameKey, w.gameId, m)?.snapshot : undefined
  }

  // Snapshots from builds before encryption carry no key: still loaded as the raw update.
  it('publishes a pointer and joiners load it before replaying newer deltas', async () => {
    const w = await world()
    w.gm.doc.getMap('meta').set('name', 'Snap')
    await settle()
    const snap = w.gm.snapshot()
    const sha = await sha256Hex(snap)
    await w.gm.publishSnapshotPointer('https://blossom.example/snap.bin', sha)
    const manifests = w.relay.stored.filter((e) => e.kind === KIND_MANIFEST)
    expect(manifests).toHaveLength(1) // replaceable
    expect(readManifest(w.gameKey, w.gameId, manifests[0])?.snapshot).toMatchObject({ url: 'https://blossom.example/snap.bin', sha256: sha })

    // Deltas older than the snapshot vanish from the relay; the joiner must still get the state.
    w.relay.stored = w.relay.stored.filter((e) => e.kind !== KIND_DELTA)
    w.gm.doc.getMap('meta').set('after', 1)
    await settle()

    const fetched: string[] = []
    const fetchImpl = (async (url: string) => {
      fetched.push(url)
      return new Response(snap.slice().buffer as ArrayBuffer, { status: 200 })
    }) as unknown as typeof fetch
    const { conn: player } = await join(w, { fetchImpl })
    expect(fetched).toEqual(['https://blossom.example/snap.bin'])
    expect(player.doc.getMap('meta').get('name')).toBe('Snap')
    expect(player.doc.getMap('meta').get('after')).toBe(1)
  })

  it('decrypts an encrypted snapshot after the ciphertext hash check', async () => {
    const w = await world()
    w.gm.doc.getMap('meta').set('name', 'Sealed')
    await settle()
    const { ciphertext, key } = await encryptBlob(w.gm.snapshot())
    const sha = await sha256Hex(ciphertext)
    await w.gm.publishSnapshotPointer('https://blossom.example/sealed', sha, key)
    expect(latestPointer(w)).toMatchObject({ sha256: sha, key })
    w.relay.stored = w.relay.stored.filter((e) => e.kind !== KIND_DELTA)
    const fetchImpl = (async () => new Response(ciphertext.slice().buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch
    const { conn: player } = await join(w, { fetchImpl })
    expect(player.doc.getMap('meta').get('name')).toBe('Sealed')
  })

  it('falls back to a full replay when the snapshot key is wrong', async () => {
    const w = await world()
    w.gm.doc.getMap('meta').set('name', 'Replay')
    await settle()
    const { ciphertext } = await encryptBlob(w.gm.snapshot())
    await w.gm.publishSnapshotPointer('https://blossom.example/sealed', await sha256Hex(ciphertext), newBlobKey())
    const fetchImpl = (async () => new Response(ciphertext.slice().buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch
    const { conn: player } = await join(w, { fetchImpl })
    expect(player.doc.getMap('meta').get('name')).toBe('Replay')
  })

  it('falls back to a full replay when the snapshot hash does not match', async () => {
    const w = await world()
    w.gm.doc.getMap('meta').set('name', 'Keep')
    await settle()
    await w.gm.publishSnapshotPointer('https://blossom.example/bad.bin', 'deadbeef')
    const fetchImpl = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch
    const { conn: player } = await join(w, { fetchImpl })
    expect(player.doc.getMap('meta').get('name')).toBe('Keep')
  })

  it('only the GM may publish pointers', async () => {
    const w = await world()
    const { conn: player } = await join(w)
    await expect(player.publishSnapshotPointer('u', 's')).rejects.toThrow(/GM/)
  })
})

describe('status', () => {
  it('goes connecting -> connected -> offline', () => {
    const t = new StatusTracker(RELAYS, 0)
    const pool = new FakePool()
    const seen: string[] = []
    t.onChange((s) => seen.push(s))
    t.attach(pool)
    expect(t.status).toBe('connecting')
    pool.connected.set(RELAYS[0], true)
    t.success(RELAYS[0])
    expect(t.status).toBe('connected')
    pool.connected.set(RELAYS[0], false)
    t.recompute()
    expect(t.status).toBe('offline')
    pool.connected.set(RELAYS[1], true)
    t.success(RELAYS[1])
    expect(t.status).toBe('connected')
    expect(seen).toEqual(['connected', 'offline', 'connected'])
    t.dispose()
  })

  it('is offline when every relay fails to connect', () => {
    const t = new StatusTracker(RELAYS, 0)
    t.attach(new FakePool())
    t.failure(RELAYS[0])
    expect(t.status).toBe('connecting')
    t.failure(RELAYS[1])
    expect(t.status).toBe('offline')
    t.dispose()
  })

  it('a connection exposes status and closes cleanly', async () => {
    const w = await world()
    expect(w.gm.status).toBe('connecting')
    const pool = new FakePool(w.relay)
    const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
    const conn = await openConnection({ relays: RELAYS, identity: localIdentity(generateSecretKey()), gameId: w.gameId, gameKey: w.gameKey, isGm: false, pool, tracker: tracker(), manifest })
    conn.close()
    expect(pool.destroyed).toBe(true)
    expect(w.relay.subs.every((s) => !s.closed)).toBe(true)
  })
})
