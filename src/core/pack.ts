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
  /** Files relative to the pack folder. */
  files: {
    attributes: string
    resources: string
    conditions: string
    sheet: string
    chargen?: string
    skills?: string[]
    /** Optional rules terms for the layered tooltips (`GlossaryTerm[]`). */
    glossary?: string
  }
}

/**
 * A rules term the tooltips can explain ("Advantage", "Saving throw"). Skill, condition and other
 * glossary texts that mention the term (or an alias) link to it. Conditions and resources are
 * terms already; a glossary entry with the same name adds to them rather than repeating them.
 */
export interface GlossaryTerm {
  id: string
  term: string
  /** Other spellings that link to this term ("save", "saves" for "Saving throw"). */
  aliases?: string[]
  text: string
}

export type RollResolution =
  | { kind: 'roll-under'; die: string }
  | { kind: 'd20-vs-dc' }

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
  | { kind: 'damage'; formula: string; resource: string }
  | { kind: 'heal'; formula: string; resource: string }
  | { kind: 'condition'; add?: string[]; remove?: string[] }
  | { kind: 'move'; cells: number }
  | { kind: 'message'; text: string }

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
