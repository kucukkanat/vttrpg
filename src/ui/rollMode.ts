/**
 * Roll mode toggles, local to this client: advantage / disadvantage for the next d20 roll, and
 * who sees the results (everyone, GM only, blind). The controller stamps them onto `roll`,
 * `skill.use` and `concentration.save` intents as they are sent, so sheet buttons, the token
 * bar, skills, `/r` and the dice pad all honour them without knowing about them.
 *
 * Advantage is spent by the roll it applies to (a damage roll without a d20 leaves it armed);
 * visibility stays until changed.
 */
import { create } from 'zustand'
import type { ChatMessage, RollAdvantage, RollVisibility } from '@/core/doc'
import type { Intent } from '@/core/intents'
import { withAdvantage, type RulesEngine } from '@/rules'

export interface RollModeState {
  advantage: RollAdvantage | null
  visibility: RollVisibility
  setAdvantage(a: RollAdvantage | null): void
  setVisibility(v: RollVisibility): void
}

export const useRollMode = create<RollModeState>((set) => ({
  advantage: null,
  visibility: 'public',
  setAdvantage: (advantage) => set({ advantage }),
  setVisibility: (visibility) => set({ visibility }),
}))

export const VISIBILITY_LABELS: Record<RollVisibility, string> = {
  public: 'Everyone',
  gm: 'GM only',
  blind: 'Blind (GM sees, you do not)',
}

/** Whether advantage changes anything about this intent (it has a d20 the roller rolls). */
export function advantageApplies(intent: Intent, rules: Pick<RulesEngine, 'pack' | 'allSkills'> | null): boolean {
  const resolution = rules?.pack.manifest.resolution
  if (intent.type === 'roll') return withAdvantage(intent.formula, 'advantage', resolution) !== null
  if (intent.type === 'concentration.save') return true
  if (intent.type === 'skill.use') {
    const skill = rules?.allSkills().find((s) => s.id === intent.skill)
    return !!skill?.effects.some((e) => e.kind === 'roll' && !/\btarget\./.test(e.formula) && withAdvantage(e.formula, 'advantage', resolution) !== null)
  }
  return false
}

/** The intent with the current toggles applied; explicit fields on the intent win. Spends advantage when used. */
export function withRollMode(intent: Intent, rules: Pick<RulesEngine, 'pack' | 'allSkills'> | null, state: RollModeState = useRollMode.getState()): Intent {
  if (intent.type !== 'roll' && intent.type !== 'skill.use' && intent.type !== 'concentration.save') return intent
  let out: Intent = intent
  if (state.advantage && !intent.advantage && advantageApplies(intent, rules)) {
    out = { ...out, advantage: state.advantage } as Intent
    state.setAdvantage(null)
  }
  if (out.type === 'roll' && !out.visibility && state.visibility !== 'public') out = { ...out, visibility: state.visibility }
  return out
}

/**
 * Whether `viewer` may read a roll's result. Public rolls and non-rolls: everyone. `gm`: the
 * roller and the GM. `blind`: the GM only.
 */
export function canSeeRoll(m: Pick<ChatMessage, 'visibility' | 'author'>, viewer: string, gm: string): boolean {
  if (!m.visibility || m.visibility === 'public') return true
  if (viewer === gm) return true
  return m.visibility === 'gm' && m.author === viewer
}

/** What someone who may not read a hidden roll sees instead. */
export function hiddenRollText(m: Pick<ChatMessage, 'visibility' | 'author' | 'text'>, viewer: string): string {
  if (m.author === viewer) return `${m.text}: rolled blind, only the GM sees the result`
  return m.visibility === 'blind' ? 'rolled blind for the GM' : 'rolled for the GM'
}
