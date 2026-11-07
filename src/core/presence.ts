/** Ephemeral, never-stored per-player state shipped over Nostr ephemeral events. */
import type { Vec3 } from './geometry'
import type { PlayerPubkey, SceneId, TokenId } from './ids'

export interface Presence {
  pubkey: PlayerPubkey
  name: string
  color: string
  scene: SceneId | null
  cursor?: Vec3
  /** Token currently being dragged and its live position, before commit. */
  dragging?: { token: TokenId; position: Vec3 }
  /** Dice roll in flight: commit hash first, then the seed. */
  rollCommit?: string
  /** A ping on the table (see table/ping.ts); clients play each distinct `at` once. */
  ping?: PresencePing
  /** GM sharing their view: where their camera is, for table displays that follow it (see table/view.ts). */
  camera?: PresenceView
  /** GM "pull everyone to my view": every client glides to this pose once per distinct `at`. */
  pull?: PresenceView
  /**
   * A GM or co-GM in Build: what they hold and have selected (their floor cursor is `cursor`).
   * Dropped when they leave Build or go idle; other builders draw it, players never do.
   */
  build?: PresenceBuild
  lastSeen: number
}

/** A builder's work in progress, kept small: ids and rounded numbers only. */
export interface PresenceBuild {
  scene: SceneId
  /** The model in hand: its catalogue id (absent for a paste or an uncatalogued pick), where its ghost rests and its turn. */
  held?: { id?: string; at: Vec3; yaw: number }
  /** Selected props, the first `MAX_BUILD_SELECTION` of them. */
  sel?: string[]
  /** How many more props are selected than `sel` lists. */
  more?: number
}

/** A camera pose on a scene: eye position, the point looked at, and the sender's clock in ms. */
export interface PresenceView {
  scene: SceneId
  pos: Vec3
  target: Vec3
  at: number
}

/** "Look here": a floor point in a scene, when it was pinged and the pinger's colour. */
export interface PresencePing {
  x: number
  z: number
  scene: SceneId
  /** Sender clock, ms; identifies the ping so a beacon that still carries it is not replayed. */
  at: number
  color: string
}

/** Players treat the GM as away once this long has passed without a presence event from them. */
export const GM_AWAY_AFTER_MS = 15_000

/** True when `lastSeen` (ms on the local clock; undefined = never seen) is older than `after` at `now`. */
export function isAway(lastSeen: number | undefined, now: number, after = GM_AWAY_AFTER_MS): boolean {
  return lastSeen === undefined || now - lastSeen > after
}

// ------------------------------------------------------------------ builder presence
// What every client needs to receive it; sending and drawing live in builderPresence.ts.

/** Selected prop ids sent; a bigger selection sends the count of the rest. */
export const MAX_BUILD_SELECTION = 24
const MAX_ID = 80
const MAX_COORD = 100_000

export const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const fixed = (n: number, digits: number) => Number(n.toFixed(digits))
const cm = (n: number) => fixed(Math.max(-MAX_COORD, Math.min(MAX_COORD, n)), 2)
export const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID

/** A point rounded to centimetres and clamped; null for anything that is not a finite point. */
export function cleanPoint(v: unknown): Vec3 | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  if (!num(p.x) || !num(p.y) || !num(p.z)) return null
  return { x: cm(p.x), y: cm(p.y), z: cm(p.z) }
}

/** A received build payload, checked and capped like a sent one; undefined when unusable. */
export function sanitizeBuildPresence(raw: unknown): PresenceBuild | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!isId(r.scene)) return undefined
  const out: PresenceBuild = { scene: r.scene as SceneId }
  const h = r.held && typeof r.held === 'object' ? (r.held as Record<string, unknown>) : null
  const at = h ? cleanPoint(h.at) : null
  if (h && at && num(h.yaw)) {
    out.held = { at, yaw: h.yaw }
    if (isId(h.id)) out.held.id = h.id
  }
  if (Array.isArray(r.sel)) {
    const sel = r.sel.filter(isId).slice(0, MAX_BUILD_SELECTION)
    if (sel.length) out.sel = sel
  }
  if (num(r.more) && r.more > 0) out.more = Math.min(Math.floor(r.more), 1_000_000)
  return out
}

/**
 * What a received presence may carry into the store: build data only from a writer (GM or co-GM)
 * and only for a viewer who builds too. Players keep none of it, the cursor included (only
 * builders draw cursors); for builders the cursor is cleaned.
 */
export function admitPresence(p: Presence, opts: { fromWriter: boolean; viewerBuilds: boolean }): Presence {
  const out: Presence = { ...p }
  const cursor = opts.viewerBuilds ? cleanPoint(p.cursor) : null
  if (cursor) out.cursor = cursor
  else delete out.cursor
  const build = opts.fromWriter && opts.viewerBuilds ? sanitizeBuildPresence(p.build) : undefined
  if (build) out.build = build
  else delete out.build
  return out
}
