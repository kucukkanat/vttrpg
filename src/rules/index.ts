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
  /** Validate an intent against the rules. Returns null if ok, else a reason. */
  validate(intent: Intent, actor: { isGm: boolean; pubkey: string }, doc: unknown): string | null
  /** Run chargen fully randomized (Mausritter one-roll) with the given seed. */
  generateCharacter(seed: string, name: string): Promise<Character>
  /** Resolve a skill use into document patches + vfx cues. */
  resolveSkill(skillId: string, source: Character, targets: Character[], seed: string): Promise<{
    patches: { character: string; data: Record<string, unknown> }[]
    messages: string[]
    vfx: VfxCue[]
  }>
}

export { loadPack, createRulesEngine, BUILTIN_PACKS } from './impl'
export { SheetView } from './SheetView'
export type { SheetViewProps } from './SheetView'
