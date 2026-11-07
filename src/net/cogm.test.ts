import { afterEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import type { GameId, PlayerPubkey } from '@/core/ids'
import type { IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { GameConnection, Identity } from './index'
import { KIND_DELTA, KIND_MANIFEST, coordinate, encryptBytes, randomGameKey, type Manifest } from './codec'
import { DELTA_COALESCE_MS, fetchManifest, manifestTemplate, openConnection, readManifest, type OpenOptions } from './connection'
import { localIdentity } from './identity'
import { StatusTracker } from './pool'
import { FakePool, FakeRelay } from './testing'
import * as Y from 'yjs'

const RELAYS = ['wss://fake.one', 'wss://fake.two']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const settle = () => sleep(DELTA_COALESCE_MS * 3)
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await sleep(5)
  }
}

let open: GameConnection[] = []
afterEach(() => {
  for (const c of open) c.close()
  open = []
})

interface World {
  relay: FakeRelay
  gameId: GameId
  gameKey: Uint8Array
  founderId: Identity
  founder: GameConnection
}

const base = (): Partial<OpenOptions> => ({ manifestSpreadMs: 0, rotateMs: 0 })

async function world(extra: Partial<OpenOptions> = {}): Promise<World> {
  const relay = new FakeRelay()
  const founderId = localIdentity(generateSecretKey())
  const gameId = crypto.randomUUID() as GameId
  const gameKey = randomGameKey()
  const manifest: Manifest = { name: 'Co-GM game', gm: founderId.pubkey, relays: RELAYS }
  const founder = await openConnection({ ...base(), relays: RELAYS, identity: founderId, gameId, gameKey, isGm: true, pool: new FakePool(relay), tracker: new StatusTracker(RELAYS, 0), manifest, fresh: true, ...extra })
  open.push(founder)
  return { relay, gameId, gameKey, founderId, founder }
}

async function connect(w: World, opts: { identity?: Identity; isGm?: boolean; expectGm?: string } & Partial<OpenOptions> = {}) {
  const identity = opts.identity ?? localIdentity(generateSecretKey())
  const pool = new FakePool(w.relay)
  const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500, opts.expectGm ?? w.founderId.pubkey)
  const conn = await openConnection({ ...base(), relays: RELAYS, identity, gameId: w.gameId, gameKey: w.gameKey, isGm: opts.isGm ?? false, pool, tracker: new StatusTracker(RELAYS, 0), manifest, ...opts })
  open.push(conn)
  return { conn, identity }
}

const beacon = (pubkey: string): Presence => ({ pubkey: pubkey as PlayerPubkey, name: 'x', color: '#fff', scene: null, lastSeen: 0 })
const say = (text: string): IntentEnvelope => ({ id: crypto.randomUUID(), from: 'x' as never, at: 1, intent: { type: 'chat.say', text } })

describe('founder pinning', () => {
  it('ignores a newer manifest that a player with the game key signed as themselves', async () => {
    const w = await world()
    // A player forges a manifest naming themselves GM; it decrypts under the game key.
    const sk = generateSecretKey()
    const forger = localIdentity(sk)
    const forged = finalizeEvent(manifestTemplate(w.gameKey, w.gameId, { name: 'Hijacked', gm: forger.pubkey, relays: RELAYS }, Math.floor(Date.now() / 1000) + 60), sk)
    w.relay.inject(forged)
    // Without a pin, the newest manifest that decrypts wins: that is the hole.
    expect((await fetchManifest(new FakePool(w.relay), RELAYS, w.gameKey, w.gameId, 1500)).manifest.gm).toBe(forger.pubkey)
    // With the invite's founder pinned, the forged one is refused.
    const pinned = await fetchManifest(new FakePool(w.relay), RELAYS, w.gameKey, w.gameId, 1500, w.founderId.pubkey)
    expect(pinned.manifest.gm).toBe(w.founderId.pubkey)
    expect(readManifest(w.gameKey, w.gameId, forged, w.founderId.pubkey)).toBeNull()
  })
})

describe('co-GM', () => {
  it('a granted co-GM writes deltas that players apply; after revocation their new deltas are refused', async () => {
    const w = await world()
    const { conn: player } = await connect(w)
    const coId = localIdentity(generateSecretKey())
    const changed: string[] = []
    player.onAuthority(() => changed.push(player.authority.coGms.join(',')))
    await w.founder.grantCoGm(coId.pubkey)
    expect(w.founder.authority.coGms).toEqual([coId.pubkey])
    await until(() => player.authority.coGms.includes(coId.pubkey as PlayerPubkey))
    expect(changed).toEqual([coId.pubkey])
    expect(player.isWriter(coId.pubkey)).toBe(true)

    const { conn: co } = await connect(w, { identity: coId, isGm: true })
    expect(co.isGm).toBe(true)
    expect(co.role).toBe('co-gm')
    co.doc.getMap('tokens').set('t1', { name: 'from co-GM' })
    await until(() => player.doc.getMap('tokens').get('t1') !== undefined)
    await until(() => w.founder.doc.getMap('tokens').get('t1') !== undefined)
    expect(w.founder.doc.getMap('tokens').get('t1')).toEqual({ name: 'from co-GM' })

    await w.founder.revokeCoGm(coId.pubkey)
    await until(() => !player.isWriter(coId.pubkey) && !co.isWriter(coId.pubkey))
    expect(co.role).toBe('player')
    // The revoked client stops publishing by itself…
    const before = w.relay.stored.filter((e) => e.kind === KIND_DELTA && e.pubkey === coId.pubkey).length
    co.doc.getMap('tokens').set('t2', { name: 'after revoke' })
    await settle()
    expect(w.relay.stored.filter((e) => e.kind === KIND_DELTA && e.pubkey === coId.pubkey).length).toBe(before)
    // …and a delta it forges anyway, even backdated into its old window, is refused live.
    const forgedDoc = new Y.Doc()
    forgedDoc.getMap('tokens').set('t3', { name: 'forged' })
    const forged = await coId.sign({
      kind: KIND_DELTA,
      created_at: Math.floor(Date.now() / 1000) - 1,
      tags: [['a', coordinate(w.founderId.pubkey as PlayerPubkey, w.gameId)], ['g', w.gameId]],
      content: encryptBytes(w.gameKey, Y.encodeStateAsUpdate(forgedDoc)),
    })
    w.relay.inject(forged as never)
    await settle()
    expect(player.doc.getMap('tokens').get('t3')).toBeUndefined()
    expect(w.founder.doc.getMap('tokens').get('t3')).toBeUndefined()
    // Earlier co-GM edits stay.
    expect(player.doc.getMap('tokens').get('t1')).toEqual({ name: 'from co-GM' })
  })

  it('refuses deltas from a player who was never granted', async () => {
    const w = await world()
    const { conn: player } = await connect(w)
    const sneakId = localIdentity(generateSecretKey())
    const d = new Y.Doc()
    d.getMap('tokens').set('x', { name: 'sneak' })
    const ev = await sneakId.sign({
      kind: KIND_DELTA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['a', coordinate(w.founderId.pubkey as PlayerPubkey, w.gameId)], ['g', w.gameId]],
      content: encryptBytes(w.gameKey, Y.encodeStateAsUpdate(d)),
    })
    w.relay.inject(ev as never)
    await settle()
    expect(player.doc.getMap('tokens').get('x')).toBeUndefined()
  })

  it('a late joiner replays co-GM deltas from inside the grant window', async () => {
    const w = await world()
    const coId = localIdentity(generateSecretKey())
    await w.founder.grantCoGm(coId.pubkey)
    const { conn: co } = await connect(w, { identity: coId, isGm: true })
    co.doc.getMap('scenes').set('s1', { name: 'Cave' })
    await settle()
    const { conn: late } = await connect(w)
    expect(late.doc.getMap('scenes').get('s1')).toEqual({ name: 'Cave' })
  })

  it('only the founder may change who runs the game or publish snapshot pointers', async () => {
    const w = await world()
    const coId = localIdentity(generateSecretKey())
    await w.founder.grantCoGm(coId.pubkey)
    const { conn: co } = await connect(w, { identity: coId, isGm: true })
    await expect(co.grantCoGm(localIdentity(generateSecretKey()).pubkey)).rejects.toThrow(/founding GM/)
    await expect(co.setHost(coId.pubkey)).rejects.toThrow(/founding GM/)
    await expect(co.publishSnapshotPointer('https://x', 'ab')).rejects.toThrow(/founding GM/)
    // A non-writer asking to be GM gets a player connection.
    const { conn: p } = await connect(w, { isGm: true })
    expect(p.isGm).toBe(false)
    expect(p.role).toBe('player')
  })
})

describe('intent processing with several writers', () => {
  it('single-writer games: the founder processes intents at once, as before', async () => {
    const w = await world({ processGraceMs: 10_000 })
    const got: IntentEnvelope[] = []
    w.founder.onIntent((i) => got.push(i))
    const { conn: player } = await connect(w)
    player.sendIntent(say('hi'))
    await until(() => got.length === 1)
    expect(w.founder.processing).toBe(true)
  })

  it('exactly one writer processes: the host while present, a co-GM once the host is gone', async () => {
    const grace = 150
    const awayMs = 300
    const w = await world({ processGraceMs: grace, gmAwayMs: awayMs })
    const coId = localIdentity(generateSecretKey())
    await w.founder.grantCoGm(coId.pubkey)
    const { conn: co } = await connect(w, { identity: coId, isGm: true, processGraceMs: grace, gmAwayMs: awayMs })
    const { conn: player } = await connect(w, { gmAwayMs: awayMs })
    const byFounder: string[] = []
    const byCo: string[] = []
    w.founder.onIntent((i) => i.intent.type === 'chat.say' && byFounder.push(i.intent.text))
    co.onIntent((i) => i.intent.type === 'chat.say' && byCo.push(i.intent.text))

    // Both beacon; after the grace the founder (host) processes and the co-GM stands by.
    const beat = setInterval(() => {
      w.founder.publishPresence(beacon(w.founderId.pubkey))
      co.publishPresence(beacon(coId.pubkey))
    }, 50)
    try {
      await sleep(grace + 100)
      expect(w.founder.processing).toBe(true)
      expect(co.processing).toBe(false)
      player.sendIntent(say('one'))
      await until(() => byFounder.length === 1)
      await sleep(50)
      expect(byCo).toEqual([])
    } finally {
      clearInterval(beat)
    }

    // The founder goes quiet (offline): the co-GM takes over once the founder counts as away.
    const coBeat = setInterval(() => co.publishPresence(beacon(coId.pubkey)), 50)
    try {
      await until(() => co.processing, awayMs + 1000)
      player.sendIntent(say('two'))
      await until(() => byCo.includes('two'))
    } finally {
      clearInterval(coBeat)
    }
  })

  it('handover: the founder makes a co-GM the host and stops processing while the co-GM is around', async () => {
    const grace = 120
    const w = await world({ processGraceMs: grace })
    const coId = localIdentity(generateSecretKey())
    await w.founder.grantCoGm(coId.pubkey)
    const { conn: co } = await connect(w, { identity: coId, isGm: true, processGraceMs: grace })
    const beat = setInterval(() => {
      w.founder.publishPresence(beacon(w.founderId.pubkey))
      co.publishPresence(beacon(coId.pubkey))
    }, 40)
    try {
      await sleep(grace + 80)
      expect(w.founder.processing).toBe(true)
      await w.founder.setHost(coId.pubkey)
      await until(() => co.authority.host === coId.pubkey)
      await until(() => co.processing && !w.founder.processing)
      // Taking it back.
      await w.founder.setHost(null)
      await until(() => w.founder.processing && !co.processing)
    } finally {
      clearInterval(beat)
    }
  })

  it('a writer that opens buffers intents for its grace, and drops them when another writer was around', async () => {
    const grace = 200
    const w = await world({ processGraceMs: grace })
    const coId = localIdentity(generateSecretKey())
    await w.founder.grantCoGm(coId.pubkey)
    // Co-GM alone (founder silent): buffered intents are delivered when its grace ends.
    const { conn: co } = await connect(w, { identity: coId, isGm: true, processGraceMs: grace })
    const got: string[] = []
    co.onIntent((i) => i.intent.type === 'chat.say' && got.push(i.intent.text))
    const { conn: player } = await connect(w)
    player.sendIntent(say('early'))
    await sleep(50)
    expect(got).toEqual([])
    await until(() => got.includes('early'), grace + 500)

    // A second co-GM device opens while the founder beacons: what it buffered was the founder's to handle.
    const { conn: co2 } = await connect(w, { identity: coId, isGm: true, processGraceMs: grace })
    const got2: string[] = []
    co2.onIntent((i) => i.intent.type === 'chat.say' && got2.push(i.intent.text))
    const beat = setInterval(() => w.founder.publishPresence(beacon(w.founderId.pubkey)), 40)
    try {
      await sleep(60)
      player.sendIntent(say('late'))
      await sleep(grace + 150)
      expect(got2).toEqual([])
      expect(co2.processing).toBe(false)
    } finally {
      clearInterval(beat)
    }
  })
})

describe('relays follow the manifest', () => {
  it('founder: brings in reserve relays when too few work and republishes the manifest with them', async () => {
    class SickPool extends FakePool {
      added: string[] = []
      health() {
        const row = (url: string, state: 'open' | 'down' | 'connecting', failures: number) => ({ url, state, failures, publishOk: 0, publishFailed: 0, rejectStreak: 0 })
        // One relay works, one is dead; reserves are still coming up.
        return [row(RELAYS[0], 'open', 0), row(RELAYS[1], 'down', 5), ...this.added.map((u) => row(u, 'connecting', 0))]
      }
      addRelay(url: string) {
        this.added.push(url)
        return true
      }
    }
    const relay = new FakeRelay()
    const id = localIdentity(generateSecretKey())
    const gameId = crypto.randomUUID() as GameId
    const gameKey = randomGameKey()
    const pool = new SickPool(relay)
    const conn = await openConnection({
      relays: RELAYS, identity: id, gameId, gameKey, isGm: true, pool, tracker: new StatusTracker(RELAYS, 0),
      manifest: { name: 'Sick', gm: id.pubkey, relays: RELAYS }, fresh: true, manifestSpreadMs: 0,
      rotateMs: 20, rotateWarmupMs: 0, reserveRelays: ['wss://spare.one', 'wss://spare.two', 'wss://spare.three', 'wss://spare.four'],
    })
    open.push(conn)
    await until(() => pool.added.length >= 2)
    await sleep(80)
    // Enough candidates now (1 open + 2 coming up): no more are pulled in.
    expect(pool.added).toEqual(['wss://spare.one/', 'wss://spare.two/'])
    expect(conn.relays).toEqual([...RELAYS, ...pool.added])
    await until(() => {
      const ev = relay.stored.find((e) => e.kind === KIND_MANIFEST)
      return !!ev && (readManifest(gameKey, gameId, ev)?.relays.length ?? 0) > RELAYS.length
    })
  })

  it('founder: no rotation while every relay is down (the device itself is offline)', async () => {
    class OfflinePool extends FakePool {
      added: string[] = []
      health() {
        return RELAYS.map((url) => ({ url, state: 'down' as const, failures: 5, publishOk: 0, publishFailed: 0, rejectStreak: 0 }))
      }
      addRelay(url: string) {
        this.added.push(url)
        return true
      }
    }
    const id = localIdentity(generateSecretKey())
    const pool = new OfflinePool(new FakeRelay())
    const conn = await openConnection({
      relays: RELAYS, identity: id, gameId: crypto.randomUUID() as GameId, gameKey: randomGameKey(), isGm: true, pool, tracker: new StatusTracker(RELAYS, 0),
      manifest: { name: 'Offline', gm: id.pubkey, relays: RELAYS }, fresh: true, manifestSpreadMs: 0, rotateMs: 10, rotateWarmupMs: 0,
    })
    open.push(conn)
    await sleep(60)
    expect(pool.added).toEqual([])
  })

  it('a player adds relays the manifest lists beyond the invite', async () => {
    const w = await world()
    const { conn: player } = await connect(w)
    expect(player.relays).toEqual(RELAYS)
    // The founder republishes with one more relay (what rotation does).
    const m: Manifest = { name: 'Co-GM game', gm: w.founderId.pubkey as PlayerPubkey, relays: [...RELAYS, 'wss://extra.test'] }
    const ev = await w.founderId.sign(manifestTemplate(w.gameKey, w.gameId, m, Math.floor(Date.now() / 1000) + 5))
    w.relay.inject(ev as never)
    await until(() => player.relays.includes('wss://extra.test/'))
    expect(w.relay.stored.some((e) => e.kind === KIND_MANIFEST)).toBe(true)
  })
})
