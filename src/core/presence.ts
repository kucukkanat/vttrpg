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
  lastSeen: number
}

/** Players treat the GM as away once this long has passed without a presence event from them. */
export const GM_AWAY_AFTER_MS = 15_000

/** True when `lastSeen` (ms on the local clock; undefined = never seen) is older than `after` at `now`. */
export function isAway(lastSeen: number | undefined, now: number, after = GM_AWAY_AFTER_MS): boolean {
  return lastSeen === undefined || now - lastSeen > after
}
