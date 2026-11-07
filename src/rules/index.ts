/**
 * Rules engine: loads a system pack and interprets it. Pure, no rendering, no networking.
 */
import type { AppliedDamage, Character, RollAdvantage, RollResult } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PackManifest, AttributeDef, ResourceDef, ConditionDef, ConditionDuration, SheetSchema, SkillDef, ChargenSchema, VfxCue } from '@/core/pack'

export interface LoadedPack {
  manifest: PackManifest
  attributes: AttributeDef[]
  resources: ResourceDef[]
  conditions: ConditionDef[]
  sheet: SheetSchema
  skills: SkillDef[]
  chargen?: ChargenSchema
}

/** One damage or heal row's result on one target of a skill, for the apply-damage card. */
export interface SkillDamage {
  /** Index into the skill's targets. */
  target: number
  /** Formula result before resistances. */
  amount: number
  /** What was applied after traits (damage) or actually recovered (heal). */
  final: number
  type?: string
  note?: string
  heal?: boolean
  /** Granted temporary points rather than healing. */
  temp?: boolean
  changes: AppliedDamage['changes']
}

/** A condition a skill added (or refreshed), for durations and concentration. */
export interface SkillCondition {
  /** Index into the skill's targets; -1 for the caster (a skill with no targets). */
  target: number
  condition: string
  duration?: ConditionDuration
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
  resolveSkill(skill: string | SkillDef, source: Character, targets: Character[], seed: string, opts?: { advantage?: RollAdvantage }): Promise<{
    patches: { character: string; data: Record<string, unknown> }[]
    messages: string[]
    vfx: VfxCue[]
    /** Damage and heal rows per target (apply-damage card). */
    damage?: SkillDamage[]
    /** Conditions added, with their durations. */
    conditions?: SkillCondition[]
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
export { withAdvantage, advantageDie, naturalDie } from './rollMode'
export { applyDamageChoice, adjustForTraits, damageTraits, changedKeys, resourceRef } from './damage'
export type { SheetViewProps } from './SheetView'
