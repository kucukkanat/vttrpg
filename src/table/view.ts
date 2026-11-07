/**
 * Shared views, pure so they can be tested without a canvas.
 *
 * - "Pull everyone to my view": the GM's presence carries `pull`, a camera pose with the time it
 *   was sent; every client glides there once per distinct `at` (like pings, the GM's beacons keep
 *   carrying it for a moment, and a client that joins later must not jump to an old pose).
 * - Table displays (`#/display`) follow the GM's camera while the GM shares it (`presence.camera`),
 *   otherwise they frame the whole scene.
 */
import type { Presence, PresenceView } from '@/core/presence'
import type { SceneId } from '@/core/ids'
import type { Vec3 } from '@/core/geometry'

/** A pull older than this on arrival is ignored. */
export const PULL_MAX_AGE_MS = 15_000
/** The GM drops the pull from presence this long after sending it. */
export const PULL_CLEAR_MS = 3000
/** A shared camera not refreshed for this long counts as stopped (the GM's tab went away). */
export const CAMERA_STALE_MS = 20_000
/** The GM publishes a moved camera at most this often while sharing. */
export const CAMERA_SHARE_INTERVAL_MS = 250

/**
 * The pull in `p` when it is new (by `at`) and fresh, from the GM, for `scene`; null otherwise.
 * `seen` remembers the last `at` taken so a beacon repeating it is ignored.
 */
export function takePull(seen: { at: number }, p: Presence | undefined, gm: string | undefined, scene: SceneId, now = Date.now()): PresenceView | null {
  const pull = p?.pull
  if (!pull || !gm || p.pubkey !== gm) return null
  if (pull.at <= seen.at) return null
  seen.at = pull.at
  if (now - pull.at > PULL_MAX_AGE_MS) return null
  return pull.scene === scene ? pull : null
}

/** The GM's shared camera for `scene` when it is current; null means "frame the scene yourself". */
export function followedCamera(p: Presence | undefined, gm: string | undefined, scene: SceneId, now = Date.now()): PresenceView | null {
  const cam = p?.camera
  if (!cam || !gm || p.pubkey !== gm || cam.scene !== scene) return null
  return now - cam.at > CAMERA_STALE_MS ? null : cam
}

/** True when two poses differ by more than `eps` meters anywhere (worth publishing again). */
export function viewMoved(a: Pick<PresenceView, 'pos' | 'target'> | null | undefined, b: Pick<PresenceView, 'pos' | 'target'>, eps = 0.02): boolean {
  if (!a) return true
  const d = (u: Vec3, v: Vec3) => Math.max(Math.abs(u.x - v.x), Math.abs(u.y - v.y), Math.abs(u.z - v.z))
  return d(a.pos, b.pos) > eps || d(a.target, b.target) > eps
}

const r3 = (v: Vec3): Vec3 => ({ x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000, z: Math.round(v.z * 1000) / 1000 })

/** A pose ready to publish: rounded to millimetres so presence events stay small. */
export function makeView(scene: SceneId, pos: Vec3, target: Vec3, at = Date.now()): PresenceView {
  return { scene, pos: r3(pos), target: r3(target), at }
}

// ------------------------------------------------------------------ display links

/** `#/join/<naddr>?k=…` invite → `#/display/<naddr>?k=…&view=…`: the same game key, a different screen. */
export function displayLinkFromInvite(invite: string, view: 'follow' | 'overview' = 'follow'): string {
  const i = invite.indexOf('#/join/')
  if (i < 0) throw new Error('not an invite link')
  return `${invite.slice(0, i)}#/display/${invite.slice(i + '#/join/'.length)}&view=${view}`
}

export interface DisplayLink {
  /** The equivalent invite link, for the network layer. */
  invite: string
  view: 'follow' | 'overview'
  grid: boolean
}

/** Read a display link back (full URL or just its hash); null when it is not one. */
export function parseDisplayLink(href: string): DisplayLink | null {
  const i = href.indexOf('#/display/')
  if (i < 0) return null
  const rest = href.slice(i + '#/display/'.length)
  const q = rest.indexOf('?')
  if (q < 0) return null
  const params = new URLSearchParams(rest.slice(q + 1))
  if (!params.get('k')) return null
  const view = params.get('view') === 'overview' ? 'overview' : 'follow'
  const grid = params.get('grid') !== '0'
  const keep = new URLSearchParams()
  keep.set('k', params.get('k')!)
  return { invite: `${href.slice(0, i)}#/join/${rest.slice(0, q)}?${keep.toString()}`, view, grid }
}
