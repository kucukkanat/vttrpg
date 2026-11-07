/**
 * GameConnection over Nostr: manifest lookup, Yjs delta transport (GM
 * publishes, everyone applies), ephemeral intents and presence, snapshots.
 * Pool access goes through `PoolLike` so tests can drive a fake pool.
 */
import * as Y from 'yjs'
import type { Event as NostrEvent, EventTemplate, Filter } from 'nostr-tools'
import type { SubCloser } from 'nostr-tools/abstract-pool'
import { normalizeURL } from 'nostr-tools/utils'
import type { GameId, PlayerPubkey, TokenId } from '@/core/ids'
import type { Intent, IntentEnvelope } from '@/core/intents'
import { GM_AWAY_AFTER_MS, isAway, type Presence } from '@/core/presence'
import type { GameAuthority, GameConnection, GameConnectionOptions, Identity, InviteInfo, SendIntentResult } from './index'
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
import { backoffMs, type PoolLike, type StatusTracker } from './pool'
import type { LocalGameStore } from './localStore'
import {
  PROCESS_GRACE_MS,
  authorityOf,
  canWriteAt,
  deltaAuthors,
  grantCoGm,
  isActiveCoGm,
  isWriter,
  processorOrder,
  revokeCoGm,
  sanitizeGrants,
  setHost,
  GRANT_SKEW_S,
  type Authority,
} from './authority'
import { RESERVE_RELAYS, planRelayRotation, relaysToAdd } from './relays'

/** Yjs transaction origin for updates that arrived from the relays. */
export const REMOTE_ORIGIN = 'net:remote'

/** Presence is throttled to this many events per second per client. */
export const PRESENCE_MIN_INTERVAL_MS = 100
/** GM-side coalescing window for Yjs updates before they go on the wire. */
export const DELTA_COALESCE_MS = 25
/** GM: how often to check for open relays that have not accepted the current manifest yet. */
export const MANIFEST_SPREAD_MS = 30_000
/** Debounce for writing the doc to the local store. */
export const PERSIST_DEBOUNCE_MS = 500
/** Fresh game: how long createGame keeps retrying until one relay accepts the manifest. */
export const MANIFEST_WAIT_MS = 20_000
/** Player: how long a queued intent waits for the GM to come back before it is dropped. */
export const INTENT_QUEUE_TTL_MS = 5 * 60_000
/** GM (founder): how often to check whether the game needs reserve relays. */
export const ROTATE_CHECK_MS = 30_000
/** GM (founder): no rotation before the relays had this long to come up. */
export const ROTATE_WARMUP_MS = 20_000
/** Intent types a player may leave in the queue while the GM is away; everything else is rejected at once. */
export const QUEUEABLE_INTENTS: ReadonlySet<Intent['type']> = new Set<Intent['type']>(['token.move', 'token.update', 'chat.say'])

// --- GM-away intent queue -------------------------------------------------------------------------

export type QueueOutcome = 'delivered' | 'expired'

interface QueuedIntent {
  env: IntentEnvelope
  at: number
  settle: (outcome: QueueOutcome) => void
}

/**
 * Player-side holding area for intents while the GM is away. Moves of the player's own tokens
 * and chat keep for `ttlMs` and go out in order on `flush`; rolls, skills and GM-only intents
 * are refused so the player hears about it at once instead of a reply that never comes.
 * Pure apart from the injected clock; `openConnection` drives it.
 */
export class IntentQueue {
  private items: QueuedIntent[] = []

  constructor(
    private readonly opts: {
      ttlMs?: number
      now?: () => number
      /** Does this client own the token (moves and updates of other tokens are refused)? */
      ownsToken?: (token: TokenId) => boolean
    } = {},
  ) {}

  get size(): number {
    return this.items.length
  }

  /** Why `env` may not wait in the queue, or null when it can. */
  reasonToReject(env: IntentEnvelope): string | null {
    const { intent } = env
    if (!QUEUEABLE_INTENTS.has(intent.type)) return 'gm-away'
    if ((intent.type === 'token.move' || intent.type === 'token.update') && this.opts.ownsToken && !this.opts.ownsToken(intent.token)) return 'not-owner'
    return null
  }

  /** Holds `env` until `flush` or expiry; the promise says which happened. */
  enqueue(env: IntentEnvelope): { queued: true; settled: Promise<QueueOutcome> } {
    let settle!: (o: QueueOutcome) => void
    const settled = new Promise<QueueOutcome>((r) => (settle = r))
    this.items.push({ env, at: this.now(), settle })
    return { queued: true, settled }
  }

  /** Drops entries older than the TTL, resolving them as expired. Returns how many were dropped. */
  expire(): number {
    const ttl = this.opts.ttlMs ?? INTENT_QUEUE_TTL_MS
    const t = this.now()
    const keep: QueuedIntent[] = []
    let dropped = 0
    for (const item of this.items) {
      if (t - item.at > ttl) {
        dropped++
        item.settle('expired')
      } else keep.push(item)
    }
    this.items = keep
    return dropped
  }

  /** Milliseconds until the oldest entry expires; undefined when the queue is empty. */
  nextExpiryIn(): number | undefined {
    const oldest = this.items[0]
    if (!oldest) return undefined
    return Math.max(0, oldest.at + (this.opts.ttlMs ?? INTENT_QUEUE_TTL_MS) - this.now())
  }

  /**
   * Sends every live entry in order through `send` (awaited one at a time so the GM sees them in
   * the order the player made them), resolving each as delivered. Expired entries are dropped
   * first. A `send` that throws has had its chance (the sender logs it); the next entry still goes.
   */
  async flush(send: (env: IntentEnvelope) => Promise<unknown>): Promise<number> {
    this.expire()
    const batch = this.items
    this.items = []
    for (const item of batch) {
      try {
        await send(item.env)
      } catch {
        // reported by the sender
      }
      item.settle('delivered')
    }
    return batch.length
  }

  /** Resolves everything as expired (connection closed). */
  clear() {
    for (const item of this.items) item.settle('expired')
    this.items = []
  }

  private now() {
    return (this.opts.now ?? Date.now)()
  }
}

export interface OpenOptions extends GameConnectionOptions {
  pool: PoolLike
  tracker: StatusTracker
  manifest: Manifest
  /** Skip the initial replay (fresh game created by this client). */
  fresh?: boolean
  /** How long to wait for the relays' EOSE on join before giving up (ms). */
  replayTimeoutMs?: number
  /** GM: period of the "republish manifest to relays that just came up" check; 0 disables. */
  manifestSpreadMs?: number
  /** Local copy of the doc and manifest (IndexedDB). Loaded before the relays, written on every change. */
  local?: LocalGameStore
  /** Fresh game: retry budget for getting the manifest accepted by at least one relay. */
  manifestWaitMs?: number
  /** Player: silence from the GM this long marks them away. */
  gmAwayMs?: number
  /** Player: how long queued intents wait for the GM. */
  queueTtlMs?: number
  /** Founder: reserve relays brought in when too few of the game's relays work. */
  reserveRelays?: string[]
  /** Founder: period of the relay rotation check; 0 disables. */
  rotateMs?: number
  /** Founder: no rotation before this long after open. */
  rotateWarmupMs?: number
  /** Multi-writer games: how long a writer listens to presence after open before it processes intents. */
  processGraceMs?: number
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
    content: encryptJson(gameKey, { ...manifest, updatedAt: createdAt }),
  }
}

/**
 * Decrypts a candidate manifest event; null when it is not ours or the key does not fit. With
 * `expectedGm` (the founder named by the invite), a manifest by anyone else is refused even when
 * it decrypts: every player holds the game key, so the key alone cannot say who the GM is.
 */
export function readManifest(gameKey: Uint8Array, gameId: GameId, ev: NostrEvent, expectedGm?: string): Manifest | null {
  if (ev.kind !== KIND_MANIFEST || tagValue(ev.tags, 'd') !== gameId) return null
  if (expectedGm && ev.pubkey !== expectedGm) return null
  try {
    const m = decryptJson<Manifest>(gameKey, ev.content)
    if (!m || typeof m !== 'object' || m.gm !== ev.pubkey) return null
    const out: Manifest = {
      name: String(m.name ?? ''),
      gm: ev.pubkey as PlayerPubkey,
      relays: Array.isArray(m.relays) ? m.relays.filter((r): r is string => typeof r === 'string') : [],
      snapshot: m.snapshot,
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : ev.created_at,
    }
    const coGms = sanitizeGrants(m.coGms, ev.pubkey)
    if (coGms.length) out.coGms = coGms
    if (typeof m.host === 'string' && m.host !== ev.pubkey && coGms.some((g) => g.pubkey === m.host && g.until === undefined)) out.host = m.host
    return out
  } catch {
    return null
  }
}

/**
 * Finds the manifest for a game. The game key authenticates it: only an event
 * whose content decrypts (NIP-44 is authenticated) and whose author matches the
 * embedded `gm` counts. Newest wins among candidates.
 */
export async function fetchManifest(pool: PoolLike, relays: string[], gameKey: Uint8Array, gameId: GameId, timeoutMs = 10_000, expectedGm?: string): Promise<{ manifest: Manifest; event: NostrEvent }> {
  const filter: Filter = { kinds: [KIND_MANIFEST], '#d': [gameId], '#t': [APP_TAG] }
  if (expectedGm) filter.authors = [expectedGm]
  const found = await pool.querySync(relays, filter, { maxWait: Math.min(timeoutMs, 6000) })
  const best = found
    .map((event) => ({ event, manifest: readManifest(gameKey, gameId, event, expectedGm) }))
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
        const manifest = readManifest(gameKey, gameId, event, expectedGm)
        if (!manifest) return
        clearTimeout(timer)
        sub.close()
        resolve({ manifest, event })
      },
    })
  })
}

export async function openConnection(opts: OpenOptions): Promise<GameConnection> {
  const { pool, tracker, identity, gameId, gameKey } = opts
  const now = opts.now ?? Date.now
  const log = opts.log ?? (() => {})
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  let manifest: Manifest = opts.manifest
  // The founder: author of the manifest, pinned by the invite. Co-GMs write under their grant.
  const gm = manifest.gm
  let auth: Authority = authorityOf(manifest)
  const amWriter = () => isWriter(auth, identity.pubkey)
  // The role this connection runs in for its lifetime; a later grant or revocation is reported
  // through `onAuthority` and takes a reopen (a revoked writer stops publishing at once).
  const isGm = opts.isGm && amWriter()
  const isFounder = identity.pubkey === gm
  const coord = coordinate(gm, gameId)
  // Relays this connection uses; grows when the manifest lists more (relay rotation).
  const relays: string[] = [...opts.relays]
  const followRelays = (list: string[]) => {
    for (const url of relaysToAdd(relays, list)) {
      if (pool.addRelay && !pool.addRelay(url)) continue
      relays.push(url)
      log('net: following relay', url)
    }
  }
  followRelays(manifest.relays)

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

  // Relays (normalized URLs) that accepted the manifest as it is now. Public relays come and go,
  // so a manifest published while only one was up gets re-sent to the others as they open.
  const manifestAccepted = new Set<string>()
  // Open relays that answered the manifest with a rejection (e.g. a kind they do not store); not retried until they reconnect.
  const manifestRefused = new Set<string>()
  let manifestInFlight = false

  /** Publishes the manifest to every relay; resolves true once one relay accepted it. */
  async function publishManifest(): Promise<boolean> {
    manifestInFlight = true
    manifestAccepted.clear()
    try {
      // Strictly increasing, so two edits within a second still replace each other on the relays.
      const createdAt = Math.max(nowSec(now), (manifest.updatedAt ?? 0) + 1)
      manifest = { ...manifest, updatedAt: createdAt }
      const ev = await signed(identity, manifestTemplate(gameKey, gameId, manifest, createdAt))
      seen.add(ev.id)
      const sent = pool.publish(relays, ev)
      const settled = Promise.allSettled(sent).then((results) => {
        results.forEach((r, i) => {
          const url = normalizeURL(relays[i])
          if (r.status === 'fulfilled') {
            manifestAccepted.add(url)
            manifestRefused.delete(url)
          } else if (!String(r.reason).includes('not connected')) {
            manifestRefused.add(url)
            log('net: manifest refused by', url, String(r.reason))
          }
        })
        log('net: manifest accepted by', [...manifestAccepted], `(${manifestAccepted.size}/${relays.length})`)
      })
      const accepted = await Promise.any(sent).then(
        () => true,
        (e: unknown) => {
          const reasons = e instanceof AggregateError ? e.errors.map(String) : [String(e)]
          log('net: no relay accepted the manifest', reasons)
          return false
        },
      )
      void settled.finally(() => {
        manifestInFlight = false
      })
      log('net: manifest published', ev.id)
      void saveManifestLocally()
      return accepted
    } catch (e) {
      manifestInFlight = false
      throw e
    }
  }

  /** Fresh game: keep publishing with backoff until a relay accepts, within the budget. */
  async function publishManifestUntilAccepted(budgetMs: number): Promise<boolean> {
    const start = now()
    for (let attempt = 0; ; attempt++) {
      if (closed) return false
      if (await publishManifest()) return true
      const delay = Math.min(backoffMs(attempt), 8000)
      if (now() + delay - start > budgetMs) {
        log('net: no relay accepted the manifest within', budgetMs, 'ms; it stays local and is republished when a relay opens')
        return false
      }
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  // --- local copy ------------------------------------------------------------------------

  const local = opts.local
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  const persistNow = () => {
    persistTimer = undefined
    if (!local) return
    local.saveDoc(gameId, Y.encodeStateAsUpdate(doc), lastDeltaAt || undefined).catch((e) => log('net: local save failed', e))
  }
  const schedulePersist = () => {
    if (!local || closed) return
    if (!persistTimer) persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS)
  }
  async function saveManifestLocally() {
    if (!local) return
    await local.saveManifest(gameId, manifest).catch((e) => log('net: local manifest save failed', e))
  }

  /** GM: republish the manifest when a relay is open that has not got the current one. */
  function spreadManifest() {
    if (closed || manifestInFlight) return
    const status = pool.listConnectionStatus()
    const missing = relays.filter((r) => {
      const url = normalizeURL(r)
      return status.get(url) && !manifestAccepted.has(url) && !manifestRefused.has(url)
    })
    if (!missing.length) return
    log('net: republishing manifest for', missing)
    publishManifest().catch((e) => log('net: manifest republish failed', e))
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
    // A co-GM whose grant was revoked mid-session: nobody accepts their deltas any more.
    if (!amWriter()) return
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

  /**
   * Validates, decrypts, reassembles and applies one delta event. Authors: the founder, or a
   * co-GM inside their grant window. A live event (after the replay) from a revoked co-GM is
   * refused even when it claims an older timestamp.
   */
  function handleDelta(ev: NostrEvent, live = false) {
    if (ev.kind !== KIND_DELTA || !canWriteAt(auth, ev.pubkey, ev.created_at)) return
    if (live && ev.pubkey !== gm && !isActiveCoGm(auth, ev.pubkey)) return
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
      deliverIntent(authoritative)
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
      if (isWriter(auth, ev.pubkey)) {
        writerPresence(ev.pubkey)
        gmSeen()
      }
      for (const cb of presenceListeners) cb(authoritative)
    } catch (e) {
      log('net: bad presence event', ev.id, e)
    }
  }

  // --- intent processing (writers) ---------------------------------------------------------------
  //
  // With co-GMs several clients receive every intent; exactly one should apply it. Each writer
  // derives the processor from the same manifest and the presence it sees: the first writer in
  // `processorOrder` that is *established* (present for `processGraceMs` without a gap, or this
  // client once it has been open that long). A writer that just opened buffers intents during its
  // grace and drops them at the end if another writer was around (that one handled them).
  // Single-writer games skip all of this: the founder processes everything at once, as before.

  const processGraceMs = opts.processGraceMs ?? PROCESS_GRACE_MS
  const writerSeen = new Map<string, { first: number; last: number }>()
  let graceQueue: IntentEnvelope[] = []
  let graceSawWriter = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  const multiWriter = () => processorOrder(auth).length > 1
  const inGrace = () => multiWriter() && now() - openedAt < processGraceMs

  function writerPresence(pk: string) {
    if (pk === identity.pubkey) return
    const t = now()
    const prev = writerSeen.get(pk)
    const fresh = prev && !isAway(prev.last, t, gmAwayMs)
    writerSeen.set(pk, { first: fresh ? prev.first : t, last: t })
    if (inGrace()) graceSawWriter = true
  }

  /** The writer that should process intents now, from this client's point of view. */
  function processor(): PlayerPubkey | undefined {
    const t = now()
    for (const pk of processorOrder(auth)) {
      if (pk === identity.pubkey) {
        if (!inGrace()) return pk
        continue
      }
      const seen = writerSeen.get(pk)
      if (seen && !isAway(seen.last, t, gmAwayMs) && t - seen.first >= processGraceMs) return pk
    }
    return undefined
  }

  const processing = () => !closed && isGm && amWriter() && (!multiWriter() || processor() === identity.pubkey)

  function deliverIntent(env: IntentEnvelope) {
    if (!isGm || !amWriter()) return
    if (inGrace()) {
      graceQueue.push(env)
      if (!graceTimer) graceTimer = setTimeout(endGrace, Math.max(0, openedAt + processGraceMs - now()) + 1)
      return
    }
    if (!processing()) return
    for (const cb of intentListeners) cb(env)
  }

  function endGrace() {
    graceTimer = undefined
    const queued = graceQueue
    graceQueue = []
    if (closed) return
    if (graceSawWriter) {
      if (queued.length) log('net: dropping', queued.length, 'intents from the grace window; another writer handled them')
      return
    }
    for (const env of queued) if (processing()) for (const cb of intentListeners) cb(env)
  }

  // --- GM away (players) -------------------------------------------------------------------------
  //
  // The GM beacons presence every few seconds; `gmAwayMs` of silence flips `gmAway`. Intents a
  // player makes meanwhile either wait in `queue` (own token moves, chat) or are refused, and the
  // queue drains, in order, the moment the GM's presence shows up again.

  const gmAwayMs = opts.gmAwayMs ?? GM_AWAY_AFTER_MS
  const openedAt = now()
  const gmAwayListeners = new Set<(away: boolean) => void>()
  let gmLastSeen: number | undefined
  let gmAway = false
  let gmAwayTimer: ReturnType<typeof setTimeout> | undefined
  let queueTimer: ReturnType<typeof setTimeout> | undefined
  const ownsToken = (token: TokenId) => {
    const t = doc.getMap<{ owner?: string }>('tokens').get(token)
    return !!t && typeof t === 'object' && t.owner === identity.pubkey
  }
  const queue = new IntentQueue({ ttlMs: opts.queueTtlMs, now, ownsToken })

  const setGmAway = (away: boolean) => {
    if (away === gmAway) return
    gmAway = away
    log(away ? 'net: GM away' : 'net: GM back')
    for (const cb of gmAwayListeners) cb(away)
  }
  /** (Re)arms the silence timer from the last GM presence (or from now). */
  const armGmAwayTimer = () => {
    if (gmAwayTimer) clearTimeout(gmAwayTimer)
    gmAwayTimer = undefined
    if (closed || isGm) return
    const wait = Math.max(0, (gmLastSeen ?? now()) + gmAwayMs - now())
    gmAwayTimer = setTimeout(() => {
      gmAwayTimer = undefined
      if (!closed && isAway(gmLastSeen ?? openedAt, now(), gmAwayMs)) setGmAway(true)
      else armGmAwayTimer()
    }, wait + 1)
  }
  /** Drops expired queue entries now and schedules the next sweep. */
  const sweepQueue = () => {
    if (queueTimer) clearTimeout(queueTimer)
    queueTimer = undefined
    queue.expire()
    const next = queue.nextExpiryIn()
    if (next !== undefined && !closed) queueTimer = setTimeout(sweepQueue, next + 1)
  }
  const sendEnvelope = (env: IntentEnvelope) =>
    publish({ kind: KIND_INTENT, created_at: nowSec(now), tags: [['g', gameId]], content: encryptJson(gameKey, env) })
  /** A presence event from the GM: back from away (if they were) and the queue goes out. */
  const gmSeen = () => {
    gmLastSeen = now()
    armGmAwayTimer()
    const wasAway = gmAway
    setGmAway(false)
    if (wasAway || queue.size > 0) {
      void queue
        .flush((env) => sendEnvelope(env).catch((e) => log('net: queued intent publish failed', e)))
        .then((n) => n && log('net: delivered', n, 'queued intents'))
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

  // Authors with a delta subscription; a new grant opens one more for the new co-GM.
  const deltaSubscribed = new Set<string>()

  /** Subscribes to deltas; buffers until EOSE, applies in created_at order, then goes live. */
  function subscribeDeltas(since: number | undefined, authors: string[] = deltaAuthors(auth)): Promise<void> {
    for (const a of authors) deltaSubscribed.add(a)
    const filter: Filter = { kinds: [KIND_DELTA], authors, '#g': [gameId] }
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
          else handleDelta(ev, true)
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

  // Local copy first: the table can show before any relay answers.
  let hadLocal = false
  let localSince: number | undefined
  if (local && !opts.fresh) {
    try {
      const saved = await local.load(gameId)
      if (saved?.update) {
        applyRemoteUpdate(saved.update)
        hadLocal = doc.store.clients.size > 0
        localSince = saved.lastDeltaAt
        if (hadLocal) {
          lastDeltaAt = Math.max(lastDeltaAt, saved.lastDeltaAt ?? 0)
          log('net: loaded local copy of', gameId, 'saved', new Date(saved.savedAt).toISOString())
        }
      }
    } catch (e) {
      log('net: local load failed', e)
    }
  }
  if (local) doc.on('update', schedulePersist)

  // A fresh game has nothing to replay and the GM never needs its own deltas back.
  if (!opts.fresh) {
    const replay = async () => {
      // With a local copy the snapshot is at best as new as what we have; only deltas since then matter.
      const since = hadLocal ? localSince : await applySnapshotPointer()
      await subscribeDeltas(since)
    }
    if (hadLocal) void replay().then(() => log('net: relay replay finished behind the local copy'))
    else await replay()
  } else {
    // Nothing to replay, but co-GMs granted later in the session write deltas the founder needs.
    void subscribeDeltas(nowSec(now))
  }

  // --- manifest updates (everyone) ------------------------------------------------------------
  //
  // The founder's manifest can change mid-session: co-GMs granted or revoked, a new host, more
  // relays, a newer snapshot. Everyone follows the founder's manifest event live; newer wins.

  const authorityListeners = new Set<() => void>()
  const authorityView = (): GameAuthority => ({
    founder: gm,
    coGms: auth.grants.filter((g) => g.until === undefined).map((g) => g.pubkey),
    host: auth.host,
  })
  function adoptManifest(next: Manifest) {
    if (closed || next.gm !== gm) return
    if ((next.updatedAt ?? 0) <= (manifest.updatedAt ?? 0)) return
    const wasWriter = amWriter()
    manifest = next
    auth = authorityOf(manifest)
    followRelays(manifest.relays)
    const fresh = deltaAuthors(auth).filter((a) => !deltaSubscribed.has(a))
    if (fresh.length) {
      const since = Math.min(...auth.grants.filter((g) => fresh.includes(g.pubkey)).map((g) => g.since)) - GRANT_SKEW_S
      void subscribeDeltas(since, fresh)
    }
    void saveManifestLocally()
    if (wasWriter !== amWriter()) log('net: this identity is', amWriter() ? 'now a writer' : 'no longer a writer', 'of', gameId)
    for (const cb of authorityListeners) cb()
  }
  subs.push(
    pool.subscribeMany(relays, { kinds: [KIND_MANIFEST], authors: [gm], '#d': [gameId] }, {
      onevent: (ev) => {
        if (seen.has(ev.id)) return
        seen.add(ev.id)
        const m = readManifest(gameKey, gameId, ev, gm)
        if (m) adoptManifest(m)
      },
    }),
  )

  /** Founder: change the manifest, tell local listeners, publish it. */
  async function editManifest(edit: (m: Manifest) => Manifest) {
    if (!isFounder || !isGm) throw new Error('net: only the founding GM can change who runs the game')
    manifest = edit(manifest)
    auth = authorityOf(manifest)
    const fresh = deltaAuthors(auth).filter((a) => !deltaSubscribed.has(a))
    if (fresh.length) void subscribeDeltas(nowSec(now) - GRANT_SKEW_S, fresh)
    for (const cb of authorityListeners) cb()
    await publishManifest()
  }

  // --- relay rotation (founder) -----------------------------------------------------------------

  function rotateRelays() {
    if (closed || !pool.health || !pool.addRelay) return
    if (now() - openedAt < (opts.rotateWarmupMs ?? ROTATE_WARMUP_MS)) return
    const health = pool.health()
    // Nothing open at all means this device is offline, not that the relays are bad.
    if (!health.some((h) => h.state === 'open')) return
    const add = planRelayRotation({ health, current: relays, reserves: opts.reserveRelays ?? RESERVE_RELAYS })
    if (!add.length) return
    log('net: too few healthy relays, bringing in', add)
    followRelays(add)
    manifest = { ...manifest, relays: [...relays] }
    publishManifest().catch((e) => log('net: manifest publish after rotation failed', e))
  }

  let spreadTimer: ReturnType<typeof setInterval> | undefined
  let rotateTimer: ReturnType<typeof setInterval> | undefined
  let offOpen = () => {}
  if (isGm) {
    doc.on('update', onLocalUpdate)
    subs.push(pool.subscribeMany(relays, { kinds: [KIND_INTENT], '#g': [gameId] }, { onevent: handleIntent }))
  }
  if (isGm && isFounder) {
    if ((opts.manifestSpreadMs ?? MANIFEST_SPREAD_MS) > 0) spreadTimer = setInterval(spreadManifest, opts.manifestSpreadMs ?? MANIFEST_SPREAD_MS)
    if ((opts.rotateMs ?? ROTATE_CHECK_MS) > 0) rotateTimer = setInterval(rotateRelays, opts.rotateMs ?? ROTATE_CHECK_MS)
    // Every (re)connect: the relay that just came up gets the manifest (with the current snapshot pointer).
    if (pool.onOpen)
      offOpen = pool.onOpen((url) => {
        manifestRefused.delete(normalizeURL(url))
        spreadManifest()
      })
  }
  if (!isFounder || !isGm) void saveManifestLocally()
  subs.push(pool.subscribeMany(relays, { kinds: [KIND_PRESENCE], '#g': [gameId] }, { onevent: handlePresence }))
  // Players: the GM counts as away after `gmAwayMs` of silence, measured from open until the first beacon.
  armGmAwayTimer()

  const conn: GameConnection = {
    doc,
    gameId,
    gm,
    isGm,
    get status() {
      return tracker.status
    },
    get relays() {
      return [...relays]
    },
    get relayCount() {
      let open = 0
      for (const v of pool.listConnectionStatus().values()) if (v) open++
      return open
    },
    sendIntent(intent): SendIntentResult {
      if (closed) return { rejected: 'closed' }
      if (isGm) {
        for (const cb of intentListeners) cb(intent)
        return { sent: true }
      }
      const env: IntentEnvelope = { ...intent, from: identity.pubkey }
      if (gmAway) {
        const reason = queue.reasonToReject(env)
        if (reason) return { rejected: reason }
        const result = queue.enqueue(env)
        sweepQueue()
        return result
      }
      sendEnvelope(env).catch((e) => log('net: intent publish failed', e))
      return { sent: true }
    },
    get gmAway() {
      return gmAway
    },
    onGmAway(cb) {
      gmAwayListeners.add(cb)
      return () => void gmAwayListeners.delete(cb)
    },
    get queuedIntents() {
      return queue.size
    },
    onIntent(cb) {
      intentListeners.add(cb)
      return () => void intentListeners.delete(cb)
    },
    reconnect() {
      pool.reconnect?.()
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
      if (!isGm || !isFounder) throw new Error('net: only the founding GM publishes snapshot pointers')
      manifest = { ...manifest, snapshot: { url, sha256, at: lastDeltaAt || nowSec(now) } }
      await publishManifest()
    },
    get hasLocalCopy() {
      return hadLocal
    },
    get role() {
      return identity.pubkey === gm ? 'gm' : isActiveCoGm(auth, identity.pubkey) ? 'co-gm' : 'player'
    },
    get authority() {
      return authorityView()
    },
    isWriter(pubkey) {
      return isWriter(auth, pubkey)
    },
    get processing() {
      return processing()
    },
    onAuthority(cb) {
      authorityListeners.add(cb)
      return () => void authorityListeners.delete(cb)
    },
    grantCoGm(pubkey) {
      return editManifest((m) => grantCoGm(m, pubkey, nowSec(now)))
    },
    revokeCoGm(pubkey) {
      return editManifest((m) => revokeCoGm(m, pubkey, nowSec(now)))
    },
    setHost(pubkey) {
      return editManifest((m) => setHost(m, pubkey ?? undefined))
    },
    relayHealth() {
      return pool.health?.() ?? [...pool.listConnectionStatus()].map(([url, open]) => ({ url, state: open ? 'open' : 'down', failures: 0, publishOk: 0, publishFailed: 0, rejectStreak: 0 }))
    },
    close() {
      if (closed) return
      closed = true
      doc.off('update', onLocalUpdate)
      if (flushTimer) clearTimeout(flushTimer)
      if (presenceTimer) clearTimeout(presenceTimer)
      if (spreadTimer) clearInterval(spreadTimer)
      if (rotateTimer) clearInterval(rotateTimer)
      if (graceTimer) clearTimeout(graceTimer)
      graceQueue = []
      authorityListeners.clear()
      if (gmAwayTimer) clearTimeout(gmAwayTimer)
      if (queueTimer) clearTimeout(queueTimer)
      queue.clear()
      gmAwayListeners.clear()
      offOpen()
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistNow()
      }
      if (local) doc.off('update', schedulePersist)
      for (const s of subs) s.close()
      intentListeners.clear()
      presenceListeners.clear()
      tracker.dispose()
      pool.destroy()
    },
  }

  if (isGm && isFounder && opts.fresh) {
    await saveManifestLocally()
    await publishManifestUntilAccepted(opts.manifestWaitMs ?? MANIFEST_WAIT_MS)
  }
  // A returning GM published nothing this session: make sure every open relay carries the manifest.
  else if (isGm && isFounder) spreadManifest()
  return conn
}
