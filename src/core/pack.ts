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
  /** Optional look for games of this pack: tints the chrome, never moves it (src/ui/theme/theme.ts). */
  theme?: PackTheme
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
  }
}

/**
 * Pack theme hook. `accent` replaces the brand amber (primary buttons, links) when it stays AA
 * readable on the current theme; `frameTint` washes the chrome panels; `displayFont` replaces the
 * display face for names, titles and totals (`src` relative to the pack folder, woff2).
 */
export interface PackTheme {
  accent?: string
  accentFg?: string
  frameTint?: string
  displayFont?: { family: string; src?: string; weight?: string }
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

export type ConditionCategory = 'buff' | 'harm' | 'control' | 'magic' | 'affliction'
export const CONDITION_CATEGORIES: readonly ConditionCategory[] = ['buff', 'harm', 'control', 'magic', 'affliction']

export interface ConditionDef {
  id: string
  name: string
  description: string
  /** Glyph name drawn on the status chip (see src/ui/theme/glyphs.ts); unknown names fall back to letters. */
  icon?: string
  /** Attribute modifiers while active, e.g. { str: -2 }. */
  modifiers?: Record<string, number>
  /**
   * Status kind, one scheme for every display: `buff` helps; `harm`, `control` (takes away actions or
   * movement) and `affliction` (poison, disease, curse, exhaustion) hinder; `magic` is neither
   * (concentration, magical marks). Sets the chip's border shape and colour (docs/UX.md, "Status
   * icons"). Absent: guessed from the id, else harm.
   */
  category?: ConditionCategory
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
