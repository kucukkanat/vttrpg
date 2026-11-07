/**
 * Shape of the shared game document. The authoritative copy lives in a Yjs Doc
 * (see `src/net`). Each top-level key is a Y.Map keyed by id; values are plain
 * JSON objects matching these interfaces. React state is derived from it.
 */
import type { AssetRef } from './assets'
import type { Cell, GridSpec, Vec3 } from './geometry'
import type { CharacterId, NoteId, PackId, PlayerPubkey, PropId, SceneId, SkillId, TokenId } from './ids'
import type { SkillDef, VfxCue } from './pack'

export type CameraMode = 'orbit' | 'token'

export interface GameMeta {
  name: string
  gm: PlayerPubkey
  pack: PackId
  packSource?: string // URL of the pack folder, if not built in
  activeScene: SceneId | null
  createdAt: number
  /** Last-seen display names keyed by pubkey; the GM records them from presence so chat can name people who have gone offline. */
  names?: Record<string, string>
  /** GM toggle: players see HP bars and condition glyphs on tokens. The GM always sees them. */
  showHpToPlayers?: boolean
}

export interface Scene {
  id: SceneId
  name: string
  /** GLB following the Blender naming convention (see PLAN.md). Omitted for image-based scenes. */
  model?: AssetRef
  /** A flat map image used as the floor (imported battle maps). The grid is laid over it. */
  image?: { asset: AssetRef; widthCells: number; heightCells: number; offset?: Vec3 }
  /** Wall segments on the XZ plane for line-of-sight when there is no COL_* geometry (imported maps). */
  walls?: { a: { x: number; z: number }; b: { x: number; z: number } }[]
  grid: GridSpec
  cameraMode: CameraMode
  ambientAudio?: AssetRef
  /** Built-in procedural ambience when no track is set (see src/audio). */
  ambientPreset?: 'none' | 'wind' | 'fire' | 'rain' | 'cave' | 'tavern' | 'forest'
  /** Fog regions that start hidden; cells revealed are tracked in `fog`. */
  darkness: number // 0..1, 0 = fully lit outdoors
  /**
   * Fog of war on or off. Unset = the old rule (fog follows `darkness > 0`), so existing games keep
   * behaving as before; once set, the toggle decides and darkness only lights the scene.
   */
  fogEnabled?: boolean
  /** Weather preset rendered by the table's WeatherLayer. */
  weather?: 'none' | 'rain' | 'snow' | 'fog' | 'embers'
  /** Transform applied to the whole scene model so an imported GLB can be fitted to the grid in-game. */
  transform?: SceneTransform
  /** Per-node overrides inside the scene model, keyed by the node's name in the GLB. */
  overrides?: Record<string, NodeOverride>
}

export interface SceneTransform {
  scale: number
  rotationY: number
  offset: Vec3
}

export interface NodeOverride {
  position?: Vec3
  rotationY?: number
  scale?: number
  hidden?: boolean
}

/** A standalone model placed in a scene (furniture, trees, props). Not a token: no owner, vision or sheet. */
export interface Prop {
  id: PropId
  scene: SceneId
  name: string
  model: AssetRef
  position: Vec3
  rotation: Vec3 // euler radians
  scale: number
  /** Locked props ignore drags on the table (GM can still edit in the panel). */
  locked?: boolean
  /** Blocks movement and line of sight when true (adds its footprint to the wall set). */
  solid?: boolean
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
  /** Height above the floor in meters (flying, standing on furniture). */
  elevation?: number
  /** Vision radius in cells; 0 = none. */
  vision: number
  /** Light emitted by this token (torch) in cells; 0 = none. */
  light: number
  hidden: boolean
  conditions: string[]
  /**
   * Skill ids this token can use, in bar order (GM-edited). Absent: every skill of the pack and the
   * game's custom skills, as before per-token skills existed.
   */
  skills?: string[]
}

/** Sheet data is pack-defined; the engine treats it as an opaque JSON object. */
export interface Character {
  id: CharacterId
  name: string
  owner?: PlayerPubkey
  portrait?: AssetRef
  /** Which of the pack's sheet layouts renders it (`PackManifest.files.sheets`); absent = the main sheet. */
  sheet?: string
  data: Record<string, unknown>
}

/**
 * A creature stat block owned by this game: a copy of a compendium entry the GM edited (a
 * reskinned goblin) or a homebrew monster. Placing it gives every token its own `Character` copy.
 */
export interface CreatureTemplate {
  id: string
  name: string
  /** Compendium key it was copied from (`CreatureEntry.key`); absent for homebrew. */
  from?: string
  /** Document key of the original's source, kept for attribution. */
  source?: string
  /** Sheet data in the pack's creature layout. */
  data: Record<string, unknown>
  updatedAt: number
}

/** One row of an encounter: N of a creature, with per-row tweaks. */
export interface EncounterRow {
  id: string
  /** `pack:<compendium key>` or `game:<template id>`; absent = a plain mini (or a chargen sheet). */
  creatureRef?: string
  count: number
  color: string
  /** Values written over the stat block on placement; `name` also names plain minis. */
  overrides?: { name?: string; ac?: number; hp?: number; notes?: string }
  /** Hit points from the stat block's average or rolled from its hit dice, per token. */
  hpMode?: 'average' | 'roll'
  /** Allies of the party: placed like the rest, left out of the difficulty budget. */
  friendly?: boolean
  /** Rows without a creature: roll a character sheet for each token with the pack's chargen. */
  generateSheet?: boolean
}

/** A prepared fight. Lives in the shared document so it follows the GM across devices. */
export interface Encounter {
  id: string
  name: string
  rows: EncounterRow[]
  /** Tokens created by the last Place, so Reveal / Hide / Remove act on exactly those. */
  placed: TokenId[]
  /** Party for the difficulty meter when set by hand; otherwise the players' claimed sheets. */
  party?: { size: number; level: number }
  /** When it was created; the Prep list is in this order. */
  createdAt?: number
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
  /** The GM revealed the whole map (`fog.revealAll`); `revealed` is kept for when fog is reset. */
  revealAll?: boolean
}

/**
 * Transient, broadcast-once happenings: VFX to play, one-shot sounds. Appended by the GM,
 * rendered by every client once (ignore events older than your join time), pruned by the GM.
 */
export type GameEvent =
  | {
      id: string; at: number; kind: 'vfx'; cues: VfxCue[]; scene: SceneId; source?: TokenId; targets: TokenId[]; point?: Vec3; label?: string
      /** Resource changes the skill caused, for floating damage and heal numbers over the tokens. */
      numbers?: ResourceDelta[]
    }
  | { id: string; at: number; kind: 'audio'; asset: AssetRef; volume?: number; by: PlayerPubkey }

/** One resource change on a token's sheet: negative for damage or a cost, positive for healing. */
export interface ResourceDelta {
  token: TokenId
  delta: number
  /** Sheet key of the resource (e.g. `hp`). */
  resource: string
}

/** GM journal entry or handout. Markdown body; optional image. */
export interface Note {
  id: NoteId
  title: string
  body: string
  image?: AssetRef
  /** 'gm' = private, 'all' = every player, or an explicit list of pubkeys. */
  sharedWith: 'gm' | 'all' | PlayerPubkey[]
  /** Pinned notes show as handouts at the top of the Journal panel. */
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

/** One combatant in the initiative order. */
export interface InitiativeEntry {
  token: TokenId
  score: number
}

/**
 * The initiative tracker, GM-driven. `order` is kept sorted by the GM's intents (highest score
 * first unless reordered by hand); `turn` indexes into it and `round` counts from 1 while active.
 * Stored as the fields of the `initiative` Y.Map; absent until the GM starts the first encounter.
 */
export interface InitiativeState {
  active: boolean
  round: number
  turn: number
  order: InitiativeEntry[]
}

export interface GameDocShape {
  meta: GameMeta
  scenes: Record<SceneId, Scene>
  tokens: Record<TokenId, Token>
  characters: Record<CharacterId, Character>
  chat: ChatMessage[]
  fog: Record<SceneId, FogState>
  events: GameEvent[]
  props: Record<PropId, Prop>
  notes: Record<NoteId, Note>
  /** Skills created or overridden in this game; merged over the pack's skills by id. */
  customSkills: Record<SkillId, SkillDef>
  /** Turn order; optional so documents from before the tracker existed still fit. */
  initiative?: InitiativeState
  /** Game-level creature templates (edited stat blocks, homebrew), keyed by id. GM data. */
  creatures?: Record<string, CreatureTemplate>
  /** Prepared encounters, keyed by id. GM data (see ARCHITECTURE.md on what players can read). */
  encounters?: Record<string, Encounter>
}

export const DOC_KEYS = ['meta', 'scenes', 'tokens', 'characters', 'chat', 'fog', 'events', 'props', 'notes', 'customSkills', 'initiative', 'creatures', 'encounters'] as const
