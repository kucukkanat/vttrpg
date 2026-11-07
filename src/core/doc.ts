/**
 * Shape of the shared game document. The authoritative copy lives in a Yjs Doc
 * (see `src/net`). Each top-level key is a Y.Map keyed by id; values are plain
 * JSON objects matching these interfaces. React state is derived from it.
 */
import type { AssetRef } from './assets'
import type { CatalogueEntry } from './catalogue'
import type { Cell, GridSpec, Vec3 } from './geometry'
import type { CharacterId, LightId, NoteId, PackId, PlayerPubkey, PrefabId, PropId, SceneId, SkillId, TokenId, WallId } from './ids'
import type { SkillDef, VfxCue } from './pack'

export type CameraMode = 'orbit' | 'token'

export interface GameMeta {
  name: string
  gm: PlayerPubkey
  pack: PackId
  packSource?: string // URL of the pack folder, if not built in
  /** A third-party pack loaded from a bundle file, shared as a content-addressed asset (see ui/packSource.ts). */
  packAsset?: AssetRef
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
  /** Players may open and close the unlocked doors drawn in this scene (`door.set`). The GM always can. */
  playersOpenDoors?: boolean
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

/**
 * A standalone model placed in a scene (furniture, trees, props). Not a token: no owner, vision or sheet.
 *
 * Model v2: the model is drawn at its real size (metres, as authored or as normalised on import)
 * times a per-axis `scale`, turned by a three-axis `rotation`. Version 1 props stored one number
 * as `scale`, a multiplier on top of a per-load "fit to one cell"; see `LegacyPropScale` and
 * `src/core/props.ts` for how those are read and migrated.
 */
export interface Prop {
  id: PropId
  scene: SceneId
  name: string
  model: AssetRef
  position: Vec3
  /** Euler radians on all three axes, three.js default order ('XYZ'). */
  rotation: Vec3
  /** Per-axis scale on the model's real size. A bare number is a version 1 prop not yet migrated. */
  scale: Vec3 | LegacyPropScale
  /** The `CatalogueEntry.id` the prop was placed from (`src/core/catalogue.ts`), when known. */
  catalogue?: string
  tags?: string[]
  /** Who placed it; filled in by apply from the intent's sender when missing. */
  createdBy?: PlayerPubkey
  /** Who wrote it last; stamped by apply. The undo stack uses it to spot someone else's change. */
  editedBy?: PlayerPubkey
  /**
   * Set once by the scale migration: the one-cell fit factor a version 1 prop was drawn with,
   * now folded into `scale`. Kept as a record (and for the undo conflict check), never applied.
   */
  legacyFit?: number
  /** Locked props ignore drags on the table (GM can still edit in the panel). */
  locked?: boolean
  /** Blocks movement and line of sight when true (adds its footprint to the wall set). */
  solid?: boolean
}

/**
 * Version 1 prop scale: one uniform number applied on top of the model fitted to at most one cell
 * (`PROP_FIT` in `src/table/fitScale.ts`), so its meaning depended on the model's bounds. Read
 * with `propScale` and replaced by a `Vec3` through `props.migrate` once the bounds are known.
 */
export type LegacyPropScale = number

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
  /** Durations and concentration links for conditions on this token (sheet or token list), by condition id. */
  effects?: Record<string, ConditionEffect>
  /** This token is concentrating on a skill; a new concentration skill ends the old one. */
  concentrating?: { skill: string; name: string }
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
  /** The same tokens by encounter row id, so each row joins initiative as one group. */
  placedRows?: Record<string, TokenId[]>
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
  /** The sheet a roll was made from (sheet rolls; initiative rolled from a sheet joins the tracker). */
  character?: CharacterId
  /** Log channel for system lines; `combat` marks skill results and encounter summaries. */
  channel?: 'combat'
  /** The end-of-encounter report, rendered as a table (kind 'system'). */
  summary?: EncounterSummary
  /**
   * Rolls: who may read the result. Absent = everyone. Hidden by the interface only: the document
   * is shared and every member holds the game key (see docs/ROLLS.md).
   */
  visibility?: RollVisibility
  /** An amount the GM (or the token's owner) can apply to tokens: the apply-damage card. */
  damage?: DamageCard
  /** A concentration save prompted by damage; `result` is set once it is rolled or dismissed. */
  concentration?: ConcentrationCheck
}

/**
 * `public`: everyone sees the result. `gm`: the roller and the GM. `blind`: the GM only; the
 * roller sees that the roll was made, and the GM mixes in its own seed so the roller cannot work
 * the result out from theirs.
 */
export type RollVisibility = 'public' | 'gm' | 'blind'
export type RollAdvantage = 'advantage' | 'disadvantage'

/** How an apply-damage button scales the card's amount; `-1` heals by the amount. */
export type DamageFactor = 1 | 0.5 | 2 | -1

/** What one apply-damage choice did to a sheet, so it can be undone or swapped for another. */
export interface AppliedDamage {
  factor: DamageFactor
  /** Final amount after the factor and the target's resistances (positive). */
  amount: number
  /** Sheet keys changed and by how much (`hp: -7`, `temp_hp: -3`), for undo. */
  changes: { key: string; delta: number }[]
  /** "resistant", "immune", "vulnerable" when a trait changed the amount. */
  note?: string
}

export interface DamageTarget {
  token: TokenId
  /** Raw amount for this target before factor and traits; defaults to the card's amount. */
  amount?: number
  applied?: AppliedDamage
}

export interface DamageCard {
  amount: number
  /** Damage type id from the pack's damage model (`fire`), if known. */
  type?: string
  /** `heal` cards apply as healing at factor 1. */
  heal?: boolean
  targets: DamageTarget[]
}

export interface ConcentrationCheck {
  token: TokenId
  dc: number
  result?: 'kept' | 'lost' | 'dismissed'
}

/** A timed or concentration-bound condition on a token. Keyed by condition id in `Token.effects`. */
export interface ConditionEffect {
  /** Turns left; absent = lasts until removed (or until the concentration holding it ends). */
  remaining?: number
  /** Count down at the start or the end of the turn of `on` (default `end`). */
  tick?: 'start' | 'end'
  /** Token whose turns count down the duration (the caster for "until the end of your next turn"); default the bearer. */
  on?: TokenId
  /** Caster concentrating on it: the condition ends when their concentration does. */
  concentration?: TokenId
}

export interface RollResult {
  formula: string
  /** Hex seed revealed after commit; every client re-derives the dice from it. */
  seed: string
  dice: { sides: number; value: number }[]
  total: number
  /** Pack-specific interpretation, e.g. { success: true, critical: false }. */
  outcome?: Record<string, unknown>
  /** Rolled with advantage or disadvantage (the formula's d20 became 2d20kh1 / 2d20kl1). */
  advantage?: RollAdvantage
}

export interface FogState {
  scene: SceneId
  /** Revealed cells encoded "q,r". */
  revealed: string[]
  /** The GM revealed the whole map (`fog.revealAll`); `revealed` is kept for when fog is reset. */
  revealAll?: boolean
  /** Cells the GM painted back into fog (`fog.hide`) after revealing the whole map; only read while `revealAll` is set. */
  hidden?: string[]
}

/**
 * A wall or door drawn on the table, or accepted from wall detection. A segment on the XZ plane in
 * world units; drawn walls join the scene's model, imported and prop walls for line of sight and
 * movement. A closed door blocks like a wall, an open one is a gap.
 */
export interface Wall {
  id: WallId
  scene: SceneId
  a: { x: number; z: number }
  b: { x: number; z: number }
  door?: { open: boolean; locked?: boolean }
  /** Where the segment came from; detected walls can be told apart and cleared together. */
  source?: 'drawn' | 'detected' | 'prefab'
}

/** A light the GM placed in a scene: a point light on the floor plan. Visual only. */
export interface PlacedLight {
  id: LightId
  scene: SceneId
  position: Vec3
  /** Reach in cells. */
  radius: number
  color: string
  /** 0..2, 1 = normal. */
  intensity?: number
}

/** A prop as stored in a prefab: position relative to the prefab's footprint corner. */
export type PrefabProp = Omit<Prop, 'id' | 'scene'>

/** A wall as stored in a prefab, relative to the footprint corner. */
export type PrefabWall = Pick<Wall, 'a' | 'b' | 'door'>

/**
 * A reusable build ("slab"): props and walls captured from a rectangle of the table, stamped back
 * on any scene with its footprint corner snapped to the grid. Positions are meters from the
 * footprint's minimum corner; `cellSize` is the grid they were captured on, so a stamp on another
 * grid scales them.
 */
export interface Prefab {
  id: PrefabId
  name: string
  /** Footprint size in meters along x and z. */
  size: { x: number; z: number }
  cellSize: number
  props: PrefabProp[]
  walls: PrefabWall[]
  createdAt: number
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
  /** Stop a one-shot (or, without `asset`, all of them) on every client. */
  | { id: string; at: number; kind: 'audio-stop'; asset?: AssetRef; by: PlayerPubkey }

/** One resource change on a token's sheet: negative for damage or a cost, positive for healing. */
export interface ResourceDelta {
  token: TokenId
  delta: number
  /** Sheet key of the resource (e.g. `hp`). */
  resource: string
  /** The loss came from a critical hit (bigger gold number, hit-stop and shake on the table). */
  crit?: boolean
  /** The resource fell from above zero to zero or below: the token is down (bigger red number). */
  down?: boolean
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
  /**
   * Group initiative: adjacent entries with the same group share one score and act in one slot
   * (a pack of goblins). Absent for a combatant acting alone.
   */
  group?: string
}

/**
 * A GM-declared next action of a combatant ("telegraph"): drawn on the board and on the turn strip
 * until the GM resolves it, the combatant uses a skill, or the encounter ends.
 */
export interface DeclaredAction {
  token: TokenId
  /** What it will do: the skill's name or the GM's own words ("Charges the door"). */
  label: string
  skill?: SkillId
  /** Skill icon name, when the action is a skill that has one. */
  icon?: string
  targets: TokenId[]
  at: number
}

/** One resource change during an encounter, collected for the end-of-combat summary. */
export interface CombatLogEntry {
  /** Who caused it (the caster of a skill); absent for a change made on the sheet by hand. */
  source?: TokenId
  target: TokenId
  /** Sheet key of the resource (e.g. `hp`). */
  resource: string
  delta: number
  /** The change took the resource from above zero to zero or below. */
  ko?: boolean
  round: number
}

/** End-of-encounter report: one row per combatant, in the order they fought. */
export interface EncounterSummary {
  rounds: number
  rows: EncounterSummaryRow[]
}

export interface EncounterSummaryRow {
  token: TokenId
  name: string
  /** A hidden token; players do not see the row. */
  hidden?: boolean
  dealt: number
  taken: number
  healed: number
  /** Knockouts scored. */
  kos: number
  /** Ended the encounter at zero. */
  down?: boolean
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
  /** Declared enemy actions by token id (absent when none). */
  declared?: Record<string, DeclaredAction>
  /** Resource changes since the encounter started (absent when none). */
  log?: CombatLogEntry[]
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
  /** Drawn walls and doors, prefabs and placed lights; optional for documents from before they existed. */
  walls?: Record<WallId, Wall>
  prefabs?: Record<PrefabId, Prefab>
  lights?: Record<LightId, PlacedLight>
  /**
   * The game's own models ("My models" in the library): imported or uploaded catalogue entries,
   * keyed by `CatalogueEntry.id`, with encrypted AssetRefs so every player can load them. Co-GMs
   * see and place them too. Written only through `catalogue.add` / `catalogue.remove` (GM).
   */
  catalogue?: Record<string, CatalogueEntry>
}

export const DOC_KEYS = ['meta', 'scenes', 'tokens', 'characters', 'chat', 'fog', 'events', 'props', 'notes', 'customSkills', 'initiative', 'walls', 'prefabs', 'lights', 'creatures', 'encounters', 'catalogue'] as const
