/**
 * GameConnection over Nostr: manifest lookup, Yjs delta transport (GM
 * publishes, everyone applies), ephemeral intents and presence, snapshots.
 * Pool access goes through `PoolLike` so tests can drive a fake pool.
 */
import * as Y from 'yjs'
import type { Event as NostrEvent, EventTemplate, Filter } from 'nostr-tools'
import type { SubCloser } from 'nostr-tools/abstract-pool'
import type { GameId, PlayerPubkey } from '@/core/ids'
import type { IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { GameConnection, GameConnectionOptions, Identity, InviteInfo } from './index'
import {
  APP_TAG,
  KIND_DELTA,
  KIND_INTENT,
  KIND_MANIFEST,
  KIND_PRESENCE,
  coordinate,
  currentBase,
  decryptBytes,
  decryptJson,
  encodeInvite,
  encryptBytes,
  encryptJson,
  parseChunkTag,
  Reassembler,
  sha256Hex,
  splitUpdate,
  tagValue,
  type InviteBase,
  type Manifest,
} from './codec'
import type { PoolLike, StatusTracker } from './pool'

/** Yjs transaction origin for updates that arrived from the relays. */
export const REMOTE_ORIGIN = 'net:remote'

/** Presence is throttled to this many events per second per client. */
export const PRESENCE_MIN_INTERVAL_MS = 100
/** GM-side coalescing window for Yjs updates before they go on the wire. */
export const DELTA_COALESCE_MS = 25

export interface OpenOptions extends GameConnectionOptions {
  pool: PoolLike
  tracker: StatusTracker
  manifest: Manifest
  /** Skip the initial replay (fresh game created by this client). */
  fresh?: boolean
  /** How long to wait for the relays' EOSE on join before giving up (ms). */
  replayTimeoutMs?: number
  fetchImpl?: typeof fetch
  inviteBase?: InviteBase
  now?: () => number
  log?: (...args: unknown[]) => void
}

const nowSec = (now: () => number) => Math.floor(now() / 1000)

async function signed(identity: Identity, t: EventTemplate): Promise<NostrEvent> {
  const ev = (await identity.sign(t)) as NostrEvent
  if (!ev || typeof ev.id !== 'string' || typeof ev.sig !== 'string') throw new Error('net: signer returned an invalid event')
  return ev
}

export function manifestTemplate(gameKey: Uint8Array, gameId: GameId, manifest: Manifest, createdAt: number): EventTemplate {
  return {
    kind: KIND_MANIFEST,
    created_at: createdAt,
    tags: [
      ['d', gameId],
      ['t', APP_TAG],
    ],
    content: encryptJson(gameKey, manifest),
  }
}

/** Decrypts a candidate manifest event; null when it is not ours or the key does not fit. */
export function readManifest(gameKey: Uint8Array, gameId: GameId, ev: NostrEvent): Manifest | null {
  if (ev.kind !== KIND_MANIFEST || tagValue(ev.tags, 'd') !== gameId) return null
  try {
    const m = decryptJson<Manifest>(gameKey, ev.content)
    if (!m || typeof m !== 'object' || m.gm !== ev.pubkey) return null
    return { name: String(m.name ?? ''), gm: ev.pubkey as PlayerPubkey, relays: Array.isArray(m.relays) ? m.relays : [], snapshot: m.snapshot }
  } catch {
    return null
  }
}

/**
 * Finds the manifest for a game. The game key authenticates it: only an event
 * whose content decrypts (NIP-44 is authenticated) and whose author matches the
 * embedded `gm` counts. Newest wins among candidates.
 */
export async function fetchManifest(pool: PoolLike, relays: string[], gameKey: Uint8Array, gameId: GameId, timeoutMs = 10_000): Promise<{ manifest: Manifest; event: NostrEvent }> {
  const filter: Filter = { kinds: [KIND_MANIFEST], '#d': [gameId], '#t': [APP_TAG] }
  const found = await pool.querySync(relays, filter, { maxWait: Math.min(timeoutMs, 6000) })
  const best = found
    .map((event) => ({ event, manifest: readManifest(gameKey, gameId, event) }))
    .filter((x): x is { event: NostrEvent; manifest: Manifest } => x.manifest !== null)
    .sort((a, b) => b.event.created_at - a.event.created_at)[0]
  if (best) return best
  // Relays can be slow to answer a one-shot query; keep a live subscription open for the rest of the budget.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.close()
      reject(new Error('net: game manifest not found on relays'))
    }, Math.max(1000, timeoutMs - 6000))
    const sub = pool.subscribeMany(relays, filter, {
      onevent: (event) => {
        const manifest = readManifest(gameKey, gameId, event)
        if (!manifest) return
        clearTimeout(timer)
        sub.close()
        resolve({ manifest, event })
      },
    })
  })
}

export async function openConnection(opts: OpenOptions): Promise<GameConnection> {
  const { pool, tracker, identity, gameId, gameKey, relays } = opts
  const now = opts.now ?? Date.now
  const log = opts.log ?? (() => {})
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  let manifest: Manifest = opts.manifest
  const gm = manifest.gm
  const isGm = opts.isGm && identity.pubkey === gm
  const coord = coordinate(gm, gameId)

  const doc = new Y.Doc()
  const seen = new Set<string>()
  const reassembler = new Reassembler()
  const intentListeners = new Set<(i: IntentEnvelope) => void>()
  const presenceListeners = new Set<(p: Presence) => void>()
  const subs: SubCloser[] = []
  let closed = false
  let lastDeltaAt = 0

  // --- publishing ----------------------------------------------------------------

  async function publish(t: EventTemplate): Promise<NostrEvent> {
    const ev = await signed(identity, t)
    seen.add(ev.id)
    // Resolve as soon as one relay accepts; the rest finish in the background.
    const sent = pool.publish(relays, ev)
    await Promise.any(sent).catch((e: unknown) => {
      const reasons = e instanceof AggregateError ? e.errors.map(String) : [String(e)]
      log('net: no relay accepted event', ev.kind, reasons)
    })
    return ev
  }

  async function publishManifest() {
    const ev = await publish(manifestTemplate(gameKey, gameId, manifest, nowSec(now)))
    log('net: manifest published', ev.id)
  }

  const batchFor = (ev: NostrEvent) => tagValue(ev.tags, 'batch') ?? ev.id

  async function publishDelta(update: Uint8Array) {
    const parts = splitUpdate(update)
    const batch = crypto.randomUUID()
    const createdAt = nowSec(now)
    lastDeltaAt = Math.max(lastDeltaAt, createdAt)
    await Promise.all(
      parts.map((part, i) => {
        const tags: string[][] = [
          ['a', coord],
          ['g', gameId],
        ]
        if (parts.length > 1) tags.push(['chunk', `${i}/${parts.length}`], ['batch', batch])
        return publish({ kind: KIND_DELTA, created_at: createdAt, tags, content: encryptBytes(gameKey, part) })
      }),
    )
  }

  // GM: coalesce local updates briefly, then ship them. Players never publish deltas.
  let pendingUpdates: Uint8Array[] = []
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const flushDeltas = () => {
    flushTimer = undefined
    if (!pendingUpdates.length) return
    const merged = pendingUpdates.length === 1 ? pendingUpdates[0] : Y.mergeUpdates(pendingUpdates)
    pendingUpdates = []
    publishDelta(merged).catch((e) => log('net: delta publish failed', e))
  }
  const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || closed) return
    pendingUpdates.push(update)
    if (!flushTimer) flushTimer = setTimeout(flushDeltas, DELTA_COALESCE_MS)
  }

  // --- receiving ---------------------------------------------------------------------

  function applyRemoteUpdate(update: Uint8Array) {
    try {
      Y.applyUpdate(doc, update, REMOTE_ORIGIN)
    } catch (e) {
      log('net: failed to apply update', e)
    }
  }

  /** Validates, decrypts, reassembles and applies one delta event. */
  function handleDelta(ev: NostrEvent) {
    if (ev.kind !== KIND_DELTA || ev.pubkey !== gm) return
    if (tagValue(ev.tags, 'g') !== gameId || tagValue(ev.tags, 'a') !== coord) return
    if (seen.has(ev.id)) return
    seen.add(ev.id)
    lastDeltaAt = Math.max(lastDeltaAt, ev.created_at)
    try {
      const { index, total } = parseChunkTag(tagValue(ev.tags, 'chunk'))
      const bytes = decryptBytes(gameKey, ev.content)
      const whole = reassembler.push(batchFor(ev), index, total, bytes)
      if (whole) applyRemoteUpdate(whole)
    } catch (e) {
      log('net: bad delta event', ev.id, e)
    }
  }

  function handleIntent(ev: NostrEvent) {
    if (ev.kind !== KIND_INTENT || tagValue(ev.tags, 'g') !== gameId) return
    if (seen.has(ev.id)) return
    seen.add(ev.id)
    if (ev.pubkey === identity.pubkey) return
    try {
      const env = decryptJson<IntentEnvelope>(gameKey, ev.content)
      if (!env || typeof env !== 'object' || !env.intent || typeof env.intent.type !== 'string') return
      // The signature, not the payload, says who sent it.
      const authoritative: IntentEnvelope = { ...env, from: ev.pubkey as PlayerPubkey }
      for (const cb of intentListeners) cb(authoritative)
    } catch (e) {
      log('net: bad intent event', ev.id, e)
    }
  }

  function handlePresence(ev: NostrEvent) {
    if (ev.kind !== KIND_PRESENCE || tagValue(ev.tags, 'g') !== gameId) return
    if (ev.pubkey === identity.pubkey) return
    if (seen.has(ev.id)) return
    seen.add(ev.id)
    try {
      const p = decryptJson<Presence>(gameKey, ev.content)
      if (!p || typeof p !== 'object') return
      const authoritative: Presence = { ...p, pubkey: ev.pubkey as PlayerPubkey }
      for (const cb of presenceListeners) cb(authoritative)
    } catch (e) {
      log('net: bad presence event', ev.id, e)
    }
  }

  // --- snapshot + replay ------------------------------------------------------------------

  async function applySnapshotPointer(): Promise<number | undefined> {
    const snap = manifest.snapshot
    if (!snap || !fetchImpl) return undefined
    try {
      const res = await fetchImpl(snap.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const digest = await sha256Hex(bytes)
      if (digest.toLowerCase() !== snap.sha256.toLowerCase()) throw new Error('sha256 mismatch')
      applyRemoteUpdate(bytes)
      log('net: snapshot applied', snap.url)
      lastDeltaAt = Math.max(lastDeltaAt, snap.at)
      return snap.at
    } catch (e) {
      log('net: snapshot unusable, replaying every delta', e)
      return undefined
    }
  }

  /** Subscribes to deltas; buffers until EOSE, applies in created_at order, then goes live. */
  function subscribeDeltas(since: number | undefined): Promise<void> {
    const filter: Filter = { kinds: [KIND_DELTA], authors: [gm], '#g': [gameId] }
    if (since !== undefined) filter.since = since
    let buffer: NostrEvent[] | null = []
    return new Promise<void>((resolve) => {
      let settled = false
      const goLive = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const events = buffer ?? []
        buffer = null
        events.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
        for (const ev of events) handleDelta(ev)
        resolve()
      }
      const timer = setTimeout(goLive, opts.replayTimeoutMs ?? 12_000)
      const sub = pool.subscribeMany(relays, filter, {
        onevent: (ev) => {
          if (buffer) buffer.push(ev)
          else handleDelta(ev)
        },
        oneose: goLive,
      })
      subs.push(sub)
    })
  }

  // --- presence throttle ----------------------------------------------------------------------

  let presencePending: Presence | null = null
  let presenceTimer: ReturnType<typeof setTimeout> | undefined
  let presenceLastSent = -Infinity
  const flushPresence = () => {
    presenceTimer = undefined
    const p = presencePending
    presencePending = null
    if (!p || closed) return
    presenceLastSent = now()
    publish({ kind: KIND_PRESENCE, created_at: nowSec(now), tags: [['g', gameId]], content: encryptJson(gameKey, p) }).catch((e) =>
      log('net: presence publish failed', e),
    )
  }

  // --- wire up ---------------------------------------------------------------------------------

  // A fresh game has nothing to replay and the GM never needs its own deltas back.
  if (!opts.fresh) {
    const since = await applySnapshotPointer()
    await subscribeDeltas(since)
  }

  if (isGm) {
    doc.on('update', onLocalUpdate)
    subs.push(pool.subscribeMany(relays, { kinds: [KIND_INTENT], '#g': [gameId] }, { onevent: handleIntent }))
  }
  subs.push(pool.subscribeMany(relays, { kinds: [KIND_PRESENCE], '#g': [gameId] }, { onevent: handlePresence }))

  const conn: GameConnection = {
    doc,
    gameId,
    gm,
    isGm,
    get status() {
      return tracker.status
    },
    relays,
    get relayCount() {
      let open = 0
      for (const v of pool.listConnectionStatus().values()) if (v) open++
      return open
    },
    sendIntent(intent) {
      if (closed) return
      if (isGm) {
        for (const cb of intentListeners) cb(intent)
        return
      }
      const env: IntentEnvelope = { ...intent, from: identity.pubkey }
      publish({ kind: KIND_INTENT, created_at: nowSec(now), tags: [['g', gameId]], content: encryptJson(gameKey, env) }).catch((e) =>
        log('net: intent publish failed', e),
      )
    },
    onIntent(cb) {
      intentListeners.add(cb)
      return () => void intentListeners.delete(cb)
    },
    publishPresence(p) {
      if (closed) return
      presencePending = p
      if (presenceTimer) return
      const wait = Math.max(0, presenceLastSent + PRESENCE_MIN_INTERVAL_MS - now())
      presenceTimer = setTimeout(flushPresence, wait)
    },
    onPresence(cb) {
      presenceListeners.add(cb)
      return () => void presenceListeners.delete(cb)
    },
    onStatus(cb) {
      return tracker.onChange(cb)
    },
    inviteLink() {
      const info: InviteInfo = { gameId, gm, relays, gameKey }
      return encodeInvite(info, opts.inviteBase ?? currentBase())
    },
    snapshot() {
      return Y.encodeStateAsUpdate(doc)
    },
    async publishSnapshotPointer(url, sha256) {
      if (!isGm) throw new Error('net: only the GM publishes snapshot pointers')
      manifest = { ...manifest, snapshot: { url, sha256, at: lastDeltaAt || nowSec(now) } }
      await publishManifest()
    },
    close() {
      if (closed) return
      closed = true
      doc.off('update', onLocalUpdate)
      if (flushTimer) clearTimeout(flushTimer)
      if (presenceTimer) clearTimeout(presenceTimer)
      for (const s of subs) s.close()
      intentListeners.clear()
      presenceListeners.clear()
      tracker.dispose()
      pool.destroy()
    },
  }

  if (isGm && opts.fresh) await publishManifest()
  return conn
}
