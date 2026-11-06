import { afterEach, describe, expect, it } from 'vitest'
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

describe('manifest', () => {
  it('is republished by the GM to relays that come up after the first publish', async () => {
    class FlakyPool extends FakePool {
      down = new Set<string>()
      override publish(relays: string[], event: Parameters<FakePool['publish']>[1]): Promise<string>[] {
        this.relay.published.push(event)
        this.relay.inject(event)
        return relays.map((r) => (this.down.has(r) ? Promise.reject(new Error('down')) : Promise.resolve('ok')))
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
    w.gm.onIntent((i) => got.push(i))

    const env: IntentEnvelope = { id: 'i1', from: w.gm.gm, at: 1, intent: { type: 'chat.say', text: 'hi' } }
    player.sendIntent(env)
    await until(() => got.length > 0)
    await sleep(20)
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
