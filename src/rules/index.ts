/**
 * Rules engine: loads a system pack and interprets it. Pure, no rendering, no networking.
 */
import type { Character, RollResult } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PackManifest, AttributeDef, ResourceDef, ConditionDef, SheetSchema, SkillDef, ChargenSchema, VfxCue } from '@/core/pack'

export interface LoadedPack {
  manifest: PackManifest
  attributes: AttributeDef[]
  resources: ResourceDef[]
  conditions: ConditionDef[]
  sheet: SheetSchema
  skills: SkillDef[]
  chargen?: ChargenSchema
}

export interface RulesEngine {
  pack: LoadedPack
  /** Deterministic: same formula + seed = same result on every client. */
  roll(formula: string, seed: string, context?: Record<string, unknown>): Promise<RollResult>
  /** Evaluate a DSL expression against a character's data (+ context). */
  evaluate(expr: string, character: Character, context?: Record<string, unknown>): Promise<number | string | boolean>
  /** Synchronous evaluation for dice-free expressions (sheet display). Throws if the expression uses dice. */
  evaluateNow(expr: string, character: Character, context?: Record<string, unknown>): number | string | boolean
  /** Validate an intent against the rules. Returns null if ok, else a reason. */
  validate(intent: Intent, actor: { isGm: boolean; pubkey: string }, doc: unknown): string | null
  /** A character with the pack's default data, for plain minis without a sheet. */
  blankCharacter(id: string, name: string): Character
  /** Run chargen fully randomized (Mausritter one-roll) with the given seed. */
  generateCharacter(seed: string, name: string): Promise<Character>
  /**
   * Resolve a skill use into document patches + vfx cues. Pass a skill id to use a pack or custom
   * skill, or a `SkillDef` to dry-run an unsaved definition (the skill editor's Test button).
   */
  resolveSkill(skill: string | SkillDef, source: Character, targets: Character[], seed: string): Promise<{
    patches: { character: string; data: Record<string, unknown> }[]
    messages: string[]
    vfx: VfxCue[]
    /** Characters a `vs` roll of the caster's showed its best natural face against (a critical hit); drives the bigger crit numbers. */
    crits?: string[]
  }>
  /**
   * Skills created or overridden in this game (`GameDocShape.customSkills`). They are merged over
   * `pack.skills` by id for lookup, validation and resolution; `pack.skills` keeps the originals.
   * Calling it again replaces the previous custom set, so removing one restores the pack's version.
   */
  setCustomSkills(skills: SkillDef[]): void
  /** Pack skills with custom overrides applied in place, followed by new custom skills. */
  allSkills(): SkillDef[]
}

export { loadPack, createRulesEngine, BUILTIN_PACKS } from './impl'
/** Validate a skill definition the way the pack loader does (throws `PackError`). */
export { guardSkill, PackError } from './load'
/** Parse a DSL expression; throws `ExprError` with a message on syntax errors. */
export { parse as parseExpression, ExprError } from './expr'
export { SheetView } from './SheetView'
export type { SheetViewProps } from './SheetView'
