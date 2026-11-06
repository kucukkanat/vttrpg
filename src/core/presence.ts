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
