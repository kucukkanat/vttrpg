/**
 * System pack format. A pack is a folder of JSON files; `pack.json` is the entry.
 * The rules engine (`src/rules`) loads and interprets these. The table engine
 * only ever sees the results (tokens, chat, VFX cues).
 */
import type { GridType, TargetShape } from './geometry'
import type { PackId, SkillId } from './ids'

export interface PackManifest {
  id: PackId
  name: string
  version: string
  description?: string
  license?: string
  grid: { type: GridType; cellSize: number }
  /**
   * How the engine turns a roll into an outcome when a target number is known.
   * `roll-under`: success when the total is <= the target (saves against a stat).
   * `d20-vs-dc`: success when the total is >= the target.
   */
  resolution?: RollResolution
  /** How damage lands: the resource it hits, temporary points, types and resistances. */
  damage?: DamageModel
  /** Concentration: one skill at a time per caster, a save when the caster takes damage. */
  concentration?: ConcentrationRule
  /** Files relative to the pack folder. */
  files: {
    attributes: string
    resources: string
    conditions: string
    sheet: string
    chargen?: string
    skills?: string[]
    /** Further sheet layouts by id (e.g. `npc`), chosen per character by `Character.sheet`. */
    sheets?: Record<string, string>
    /** Templates that turn stat-block actions into skills (`CreatureActionTemplates`). */
    creatureActions?: string
    /** Encounter difficulty budget (`EncounterRules`). */
    encounter?: string
  }
  /** Creature compendium; its snapshot files are fetched only when the GM opens the browser. */
  creatures?: CreatureConfig
}

/**
 * Where the pack keeps creatures and which sheet keys mean what, so the encounter builder can
 * apply overrides and budgets without knowing the system. Paths are dotted sheet-data paths.
 */
export interface CreatureConfig {
  /** Compendium snapshots (`CreatureFile`), relative to the pack folder. */
  files: string[]
  /** Sheet layout id (a key of `files.sheets`) creature characters use. */
  sheet?: string
  /** Resource holding hit points (`{ current, max }`). */
  hp: string
  /** Dice formula string for rolled hit points, e.g. `hp_dice`. */
  hpFormula?: string
  /** Number the AC override writes. */
  ac?: string
  /** Experience value used by the difficulty meter. */
  xp?: string
  /** Challenge rating (number) and its display text, for the browser's filter and list. */
  cr?: string
  crText?: string
  /** Text field the encounter row's notes are written into. */
  notes?: string
}

/** One compendium creature: search fields plus sheet data in the pack's creature layout. */
export interface CreatureEntry {
  /** Stable id within the pack, e.g. `srd-2024_goblin-warrior`. */
  key: string
  name: string
  /** Document key of the source (`srd-2024`); its licence and attribution are in the file header. */
  source: string
  cr?: number
  xp?: number
  type?: string
  size?: string
  data: Record<string, unknown>
}

export interface CreatureDocument {
  key: string
  name: string
  /** Short name for lists, e.g. "SRD 5.2.1". */
  title?: string
  license: string
  attribution: string
  url?: string
  via?: string
}

export interface CreatureFile {
  document: CreatureDocument
  creatures: CreatureEntry[]
}

/**
 * Templates that compile a creature's stat-block actions into ordinary skills, so monsters use the
 * same targeting, VFX and outcome flow as characters. `list` is the sheet list holding the actions
 * and `kindField` the item field naming a template. In template strings `$.` becomes the action's
 * data path (`actions.2.`) so rolls read the live sheet, and `${field}` / `${field|default}` the
 * field's value at compile time (ability ids, ranges). Actions without a matching template, or
 * missing a `requires` field, stay text on the sheet.
 */
export interface CreatureActionTemplates {
  list: string
  kindField: string
  templates: Record<string, CreatureActionTemplate>
}

export interface CreatureActionTemplate {
  requires?: string[]
  icon?: string
  /** Shape with numbers or `${...}` strings; numeric strings become numbers after substitution. */
  target: Record<string, unknown>
  cost?: { resource: string; amount: string }[]
  effects: Effect[]
  vfx: VfxCue[]
}

/**
 * Encounter difficulty as data: per-character XP budgets by level for each band, the character
 * field holding a level and the creature field holding XP. The engine only adds numbers up.
 */
export interface EncounterRules {
  /** Where the table comes from, shown under the meter. */
  source: string
  /** Sheet path of a character's level. */
  level: string
  /** Sheet path of a creature's XP. */
  xp: string
  bands: { id: string; name: string }[]
  /** Level (as a string key) to one budget per band, in `bands` order. */
  budget: Record<string, number[]>
}

export type RollResolution =
  | { kind: 'roll-under'; die: string }
  | { kind: 'd20-vs-dc' }

/**
 * The pack's damage model, read by the engine for skill damage and by apply-damage cards. Packs
 * without one keep plain `damage` rows against whatever resource they name.
 */
export interface DamageModel {
  /** Resource that damage and healing go to by default (`hp`). */
  resource: string
  /** Sheet key of a plain number spent before `resource` and never healed: temporary hit points. */
  temp?: string
  /** Damage types the pack knows; effect rows and cards name them by id. */
  types?: { id: string; name: string }[]
  /** Sheet keys holding lists of damage type ids; the id `all` matches every type. */
  resist?: string
  vulnerable?: string
  immune?: string
}

export interface ConcentrationRule {
  /** Condition id shown on a concentrating caster. */
  condition: string
  /** Save formula against the caster's sheet, e.g. "d20 + con_mod + save_prof.con * pb". */
  save: string
  /** DC expression; `damage` is the damage just taken, e.g. "max(10, floor(damage / 2))". */
  dc: string
}

export interface AttributeDef {
  id: string
  name: string
  abbr?: string
  min?: number
  max?: number
  /** Expression in the pack DSL, e.g. "floor((str - 10) / 2)". */
  derived?: string
}

export interface ResourceDef {
  id: string
  name: string
  /** Expression for the maximum, e.g. "con + level". */
  max: string
  resetOn?: 'rest' | 'longRest' | 'session' | 'never'
}

export interface ConditionDef {
  id: string
  name: string
  description: string
  icon?: string
  /** Attribute modifiers while active, e.g. { str: -2 }. */
  modifiers?: Record<string, number>
  /** For status displays: helps (`buff`), hinders (`debuff`) or neither. */
  category?: 'buff' | 'debuff' | 'neutral'
  /** Damage type ids this condition grants resistance, immunity or vulnerability to (`all` for every type). */
  resist?: string[]
  immune?: string[]
  vulnerable?: string[]
}

export type SheetField =
  | { kind: 'number'; bind: string; label: string; readonly?: boolean }
  | { kind: 'text'; bind: string; label: string; multiline?: boolean }
  | { kind: 'resource'; bind: string; label: string }
  | {
      kind: 'inventory-grid'
      bind: string
      label: string
      cols: number
      rows: number
      /** Optional labels for the first slots (e.g. paws, body); unlabeled slots are general storage. */
      slotLabels?: string[]
    }
  | { kind: 'list'; bind: string; label: string; item: SheetField[] }
  | { kind: 'roll'; label: string; formula: string }
  /** Read-only value computed from a dice-free expression (derived attributes, modifiers). */
  | { kind: 'computed'; label: string; expr: string }

export interface SheetSection {
  title: string
  columns?: number
  fields: SheetField[]
}

export interface SheetSchema {
  sections: SheetSection[]
}

/** One row of a skill's effect. Interpreted by the rules engine. */
export type Effect =
  | { kind: 'roll'; formula: string; vs?: string; label?: string }
  /** `type` is a damage type id from the pack's damage model; resistances apply when it is set. */
  | { kind: 'damage'; formula: string; resource: string; type?: string }
  | { kind: 'heal'; formula: string; resource: string }
  /** `duration` sets a countdown on the added conditions (see `ConditionDuration`). */
  | { kind: 'condition'; add?: string[]; remove?: string[]; duration?: ConditionDuration }
  | { kind: 'move'; cells: number }
  | { kind: 'message'; text: string }

/**
 * How long an added condition lasts, in turns of `on` (default `target`, the bearer): it counts down
 * at the start or the end (default) of that token's turn while initiative runs, and ends at zero.
 */
export interface ConditionDuration {
  turns: number
  tick?: 'start' | 'end'
  on?: 'source' | 'target'
}

/** VFX cue sent to the table engine. Presets live in `src/table/vfx`. */
export interface VfxCue {
  at: number // ms offset in the timeline
  preset: 'hit' | 'projectile' | 'ring' | 'rain' | 'aura' | 'beam' | 'shake' | 'sound'
  from?: 'source' | 'target' | 'point'
  to?: 'source' | 'target' | 'point'
  color?: string
  duration?: number
  asset?: string // for 'sound'
}

export interface SkillDef {
  id: SkillId
  name: string
  description: string
  icon?: string
  cost?: { resource: string; amount: string }[]
  target: TargetShape
  effects: Effect[]
  vfx: VfxCue[]
  /**
   * Only tokens whose `skills` list names it have it (compiled stat-block actions): it is left out
   * of the implicit every-skill list and the add-skill picker.
   */
  onlyListed?: boolean
  /**
   * Needs concentration (packs with a `concentration` rule): using it ends the caster's previous
   * concentration skill, and the conditions it adds end when the concentration does.
   */
  concentration?: boolean
}

export interface ChargenStep {
  id: string
  title: string
  /** Expressions assigning sheet fields, e.g. { str: "max(3d6 drop lowest, ...)" }. */
  assign?: Record<string, string>
  /** Table id to roll on; result merged into the sheet. */
  table?: string
  choose?: { bind: string; options: string[] }
  /** Literal values merged into the sheet (arrays append, inventory arrays are placed into the grid). */
  set?: Record<string, unknown>
}

export interface ChargenSchema {
  steps: ChargenStep[]
  tables: Record<string, { die: string; rows: Record<string, Record<string, unknown>> }>
}
