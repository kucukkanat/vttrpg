import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey } from 'nostr-tools'
import type { GameId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import type { GameConnection } from './index'
import { KIND_MANIFEST, randomGameKey, sha256Hex, type Manifest } from './codec'
import { fetchManifest, openConnection, readManifest } from './connection'
import { localIdentity } from './identity'
import { StatusTracker } from './pool'
import { createSnapshotLoop, startSnapshotLoop, EVENT_PRUNE_AFTER_MS, SNAPSHOT_INTERVAL_MS, SNAPSHOT_MAX_DELTAS } from './snapshots'
import { FakePool, FakeRelay } from './testing'

const RELAYS = ['wss://fake.one', 'wss://fake.two']

interface World {
  relay: FakeRelay
  gameId: GameId
  gameKey: Uint8Array
  gm: GameConnection
  open: GameConnection[]
}

async function createWorld(): Promise<World> {
  const relay = new FakeRelay()
  const identity = localIdentity(generateSecretKey())
  const gameId = crypto.randomUUID() as GameId
  const gameKey = randomGameKey()
  const manifest: Manifest = { name: 'Snap game', gm: identity.pubkey, relays: RELAYS }
  const gm = await openConnection({ relays: RELAYS, identity, gameId, gameKey, isGm: true, pool: new FakePool(relay), tracker: new StatusTracker(RELAYS, 0), manifest, fresh: true })
  return { relay, gameId, gameKey, gm, open: [gm] }
}

/** A fake Blossom: stores bytes by hash and serves them back through `fetchImpl`. */
function fakeBlossom() {
  const blobs = new Map<string, Uint8Array>()
  let failures = 0
  const upload = vi.fn(async (bytes: Uint8Array) => {
    if (failures > 0) {
      failures--
      throw new Error('blossom down')
    }
    const sha256 = await sha256Hex(bytes)
    blobs.set(sha256, bytes)
    return { url: `https://blossom.test/${sha256}`, sha256 }
  })
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const bytes = blobs.get(url.slice(url.lastIndexOf('/') + 1))
    if (!bytes) return new Response(null, { status: 404 })
    return new Response(bytes as BlobPart, { status: 200 })
  }) as typeof fetch
  return { blobs, upload, fetchImpl, failNext: (n: number) => void (failures = n) }
}

function latestManifest(w: World): Manifest | null {
  const events = w.relay.stored.filter((e) => e.kind === KIND_MANIFEST).sort((a, b) => b.created_at - a.created_at)
  return events.length ? readManifest(w.gameKey, w.gameId, events[0]) : null
}

/** Drains pending promise chains under fake timers without advancing the clock. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0)
}

let worlds: World[] = []
const world = async () => {
  const w = await createWorld()
  worlds.push(w)
  return w
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const w of worlds) for (const c of w.open) c.close()
  worlds = []
  vi.useRealTimers()
})

describe('snapshot loop', () => {
  it('does nothing on a tick when the doc did not change', async () => {
    const w = await world()
    const b = fakeBlossom()
    const stop = startSnapshotLoop(w.gm, { upload: b.upload })
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS * 3)
    expect(b.upload).not.toHaveBeenCalled()
    expect(latestManifest(w)?.snapshot).toBeUndefined()
    stop()
  })

  it('uploads and republishes the manifest two minutes after a change, once', async () => {
    const w = await world()
    const b = fakeBlossom()
    const log = vi.fn()
    const loop = createSnapshotLoop(w.gm, { upload: b.upload, log })
    const stop = loop.stop
    w.gm.doc.getMap('meta').set('name', 'changed')
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS - 1)
    expect(b.upload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await loop.flush() // resolves with the in-flight snapshot
    expect(b.upload).toHaveBeenCalledTimes(1)
    const m = latestManifest(w)
    expect(m?.snapshot?.url).toMatch(/^https:\/\/blossom\.test\//)
    expect(m?.snapshot?.sha256).toBe(await sha256Hex(b.upload.mock.calls[0][0]))
    expect(log).toHaveBeenCalledWith('net: snapshot published', expect.any(Number), 'bytes ->', m?.snapshot?.url)
    // Quiet afterwards: no second upload without new changes.
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS * 2)
    expect(b.upload).toHaveBeenCalledTimes(1)
    stop()
  })

  it('snapshots immediately once the local update count passes the threshold', async () => {
    const w = await world()
    const b = fakeBlossom()
    const loop = createSnapshotLoop(w.gm, { upload: b.upload })
    const tokens = w.gm.doc.getMap('tokens')
    for (let i = 0; i < SNAPSHOT_MAX_DELTAS - 1; i++) tokens.set(`t${i}`, { i })
    expect(loop.pendingDeltas).toBe(SNAPSHOT_MAX_DELTAS - 1)
    expect(b.upload).not.toHaveBeenCalled()
    tokens.set('last', { i: -1 })
    await loop.flush()
    expect(b.upload).toHaveBeenCalledTimes(1)
    expect(loop.pendingDeltas).toBe(0)
    expect(loop.dirty).toBe(false)
    loop.stop()
  })

  it('ignores remote updates when counting deltas', async () => {
    const w = await world()
    const b = fakeBlossom()
    // A player's connection on the same relay receives the GM's deltas as remote updates.
    const pool = new FakePool(w.relay)
    const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
    const player = await openConnection({ relays: RELAYS, identity: localIdentity(generateSecretKey()), gameId: w.gameId, gameKey: w.gameKey, isGm: false, pool, tracker: new StatusTracker(RELAYS, 0), manifest })
    w.open.push(player)
    const loop = createSnapshotLoop(player as GameConnection, { upload: b.upload })
    // Not the GM: the loop refuses to run at all.
    expect(loop.dirty).toBe(false)
    const gmLoop = createSnapshotLoop(w.gm, { upload: b.upload })
    w.gm.doc.getMap('meta').set('x', 1)
    await vi.advanceTimersByTimeAsync(100)
    expect(gmLoop.pendingDeltas).toBe(1)
    gmLoop.stop()
    loop.stop()
  })

  it('logs and retries on the next tick when the upload fails, without throwing', async () => {
    const w = await world()
    const b = fakeBlossom()
    b.failNext(1)
    const log = vi.fn()
    const loop = createSnapshotLoop(w.gm, { upload: b.upload, log })
    w.gm.doc.getMap('meta').set('name', 'changed')
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    await settle()
    expect(b.upload).toHaveBeenCalledTimes(1)
    expect(latestManifest(w)?.snapshot).toBeUndefined()
    expect(log).toHaveBeenCalledWith('net: snapshot failed, retrying next tick', expect.any(Error))
    expect(loop.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    await loop.flush()
    expect(b.upload).toHaveBeenCalledTimes(2)
    expect(latestManifest(w)?.snapshot).toBeDefined()
    loop.stop()
  })

  it('asks the controller to prune events older than two minutes on every tick', async () => {
    const w = await world()
    const b = fakeBlossom()
    const pruned: Intent[] = []
    let t = 1_000_000_000_000
    const stop = startSnapshotLoop(w.gm, { upload: b.upload, prune: (i) => void pruned.push(i), now: () => t })
    t += SNAPSHOT_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    t += SNAPSHOT_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    expect(pruned).toEqual([
      { type: 'event.prune', before: 1_000_000_000_000 + SNAPSHOT_INTERVAL_MS - EVENT_PRUNE_AFTER_MS },
      { type: 'event.prune', before: 1_000_000_000_000 + 2 * SNAPSHOT_INTERVAL_MS - EVENT_PRUNE_AFTER_MS },
    ])
    stop()
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    expect(pruned).toHaveLength(2)
  })

  it('a prune that throws does not stop the loop', async () => {
    const w = await world()
    const b = fakeBlossom()
    const log = vi.fn()
    const loop = createSnapshotLoop(w.gm, { upload: b.upload, log, prune: () => { throw new Error('boom') } })
    const stop = loop.stop
    w.gm.doc.getMap('meta').set('name', 'changed')
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    await loop.flush()
    expect(log).toHaveBeenCalledWith('net: event prune failed', expect.any(Error))
    expect(b.upload).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a late joiner loads the snapshot instead of replaying every delta', async () => {
    const w = await world()
    const b = fakeBlossom()
    const loop = createSnapshotLoop(w.gm, { upload: b.upload })
    const meta = w.gm.doc.getMap('meta')
    meta.set('name', 'Snap game')
    meta.set('gm', w.gm.gm)
    for (let i = 0; i < 20; i++) w.gm.doc.getMap('tokens').set(`t${i}`, { i })
    await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS)
    await loop.flush()
    expect(b.upload).toHaveBeenCalledTimes(1)
    const snapAt = latestManifest(w)!.snapshot!.at

    // Drop every stored delta so the only way to get the state is the snapshot.
    w.relay.stored = w.relay.stored.filter((e) => e.kind === KIND_MANIFEST)

    const log = vi.fn()
    const pool = new FakePool(w.relay)
    const { manifest } = await fetchManifest(pool, RELAYS, w.gameKey, w.gameId, 1500)
    expect(manifest.snapshot?.at).toBe(snapAt)
    const player = await openConnection({
      relays: RELAYS,
      identity: localIdentity(generateSecretKey()),
      gameId: w.gameId,
      gameKey: w.gameKey,
      isGm: false,
      pool,
      tracker: new StatusTracker(RELAYS, 0),
      manifest,
      fetchImpl: b.fetchImpl,
      log,
    })
    w.open.push(player)
    expect(log).toHaveBeenCalledWith('net: snapshot applied', manifest.snapshot!.url)
    expect(player.doc.getMap('meta').get('name')).toBe('Snap game')
    expect(player.doc.getMap('tokens').size).toBe(20)
    loop.stop()
  })

  it('a returning GM gets the doc back from the relays and is authoritative again', async () => {
    const w = await world()
    const meta = w.gm.doc.getMap('meta')
    meta.set('name', 'Snap game')
    meta.set('gm', w.gm.gm)
    w.gm.doc.getMap('tokens').set('t1', { hp: 3 })
    await vi.advanceTimersByTimeAsync(100) // let the GM's coalesced deltas ship

    // A world whose GM key we hold, so the same identity can come back in a "fresh tab".
    const gmId = localIdentity(generateSecretKey())
    const relay = new FakeRelay()
    const gameId = crypto.randomUUID() as GameId
    const gameKey = randomGameKey()
    const manifest: Manifest = { name: 'Return', gm: gmId.pubkey, relays: RELAYS }
    const first = await openConnection({ relays: RELAYS, identity: gmId, gameId, gameKey, isGm: true, pool: new FakePool(relay), tracker: new StatusTracker(RELAYS, 0), manifest, fresh: true })
    first.doc.getMap('meta').set('gm', gmId.pubkey)
    first.doc.getMap('tokens').set('t1', { hp: 3 })
    await vi.advanceTimersByTimeAsync(100)
    first.close()

    const pool = new FakePool(relay)
    const found = await fetchManifest(pool, RELAYS, gameKey, gameId, 1500)
    const back = await openConnection({ relays: RELAYS, identity: gmId, gameId, gameKey, isGm: true, pool, tracker: new StatusTracker(RELAYS, 0), manifest: found.manifest })
    expect(back.isGm).toBe(true)
    expect(back.doc.getMap('meta').get('gm')).toBe(gmId.pubkey)
    expect(back.doc.getMap('tokens').get('t1')).toEqual({ hp: 3 })
    expect(back.relays).toEqual(RELAYS)
    expect(back.relayCount).toBe(0) // FakePool reports no open sockets

    // And a different identity claiming GM is refused by net.
    const impostor = await openConnection({ relays: RELAYS, identity: localIdentity(generateSecretKey()), gameId, gameKey, isGm: true, pool: new FakePool(relay), tracker: new StatusTracker(RELAYS, 0), manifest: found.manifest })
    expect(impostor.isGm).toBe(false)
    back.close()
    impostor.close()
  })
})
