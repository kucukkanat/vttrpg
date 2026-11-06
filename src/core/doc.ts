/**
 * Shape of the shared game document. The authoritative copy lives in a Yjs Doc
 * (see `src/net`). Each top-level key is a Y.Map keyed by id; values are plain
 * JSON objects matching these interfaces. React state is derived from it.
 */
import type { AssetRef } from './assets'
import type { Cell, GridSpec, Vec3 } from './geometry'
import type { CharacterId, PackId, PlayerPubkey, SceneId, TokenId } from './ids'

export type CameraMode = 'orbit' | 'token'

export interface GameMeta {
  name: string
  gm: PlayerPubkey
  pack: PackId
  packSource?: string // URL of the pack folder, if not built in
  activeScene: SceneId | null
  createdAt: number
}

export interface Scene {
  id: SceneId
  name: string
  /** GLB following the Blender naming convention (see PLAN.md). */
  model: AssetRef
  grid: GridSpec
  cameraMode: CameraMode
  ambientAudio?: AssetRef
  /** Fog regions that start hidden; cells revealed are tracked in `fog`. */
  darkness: number // 0..1, 0 = fully lit outdoors
}

export interface Token {
  id: TokenId
  scene: SceneId
  name: string
  /** Which character sheet this token represents, if any. */
  character?: CharacterId
  /** Owner may move it; GM may move anything. */
  owner?: PlayerPubkey
  model?: AssetRef
  /** Fallback when no model: a colored disc with initials. */
  color: string
  position: Vec3
  cell?: Cell
  rotationY: number
  scale: number
  /** Vision radius in cells; 0 = none. */
  vision: number
  /** Light emitted by this token (torch) in cells; 0 = none. */
  light: number
  hidden: boolean
  conditions: string[]
}

/** Sheet data is pack-defined; the engine treats it as an opaque JSON object. */
export interface Character {
  id: CharacterId
  name: string
  owner?: PlayerPubkey
  portrait?: AssetRef
  data: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  author: PlayerPubkey
  at: number
  kind: 'say' | 'roll' | 'system' | 'whisper'
  text: string
  /** Present for kind 'roll'. */
  roll?: RollResult
  to?: PlayerPubkey[]
}

export interface RollResult {
  formula: string
  /** Hex seed revealed after commit; every client re-derives the dice from it. */
  seed: string
  dice: { sides: number; value: number }[]
  total: number
  /** Pack-specific interpretation, e.g. { success: true, critical: false }. */
  outcome?: Record<string, unknown>
}

export interface FogState {
  scene: SceneId
  /** Revealed cells encoded "q,r". */
  revealed: string[]
}

export interface GameDocShape {
  meta: GameMeta
  scenes: Record<SceneId, Scene>
  tokens: Record<TokenId, Token>
  characters: Record<CharacterId, Character>
  chat: ChatMessage[]
  fog: Record<SceneId, FogState>
}

export const DOC_KEYS = ['meta', 'scenes', 'tokens', 'characters', 'chat', 'fog'] as const
