/**
 * Casting a token's skills: the token's skill list, evaluated costs, why a skill is unavailable, and
 * `use` (aim on the table, or fire at once for `self` skills). Shared by the skill bar over the
 * table and the Skills panel.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { Character, Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { TokenId } from '@/core/ids'
import { useTargeting } from '../targeting'
import { skillShortfall } from '../panels/SkillsPanel'
import { tokenSkillList } from './tokenSkills'

export interface SkillCasting {
  skills: SkillDef[]
  character: Character | undefined
  /** The viewer may cast from this token (GM, or its owner) and it has a sheet. */
  canUse: boolean
  labelOf(id: string): string
  /** Why `skill` cannot be cast now, or null. */
  shortfall(skill: SkillDef): string | null
  /** The skill being aimed from this token, if any. */
  aiming: string | null
  use(skill: SkillDef): void
}

export function useSkillCasting(controller: GameController, token: Token | undefined): SkillCasting {
  const rules = controller.rules
  const character = useGame((s) => (token?.character ? s.characters[token.character] : undefined))
  const custom = useGame((s) => s.customSkills)
  const pending = useTargeting((s) => s.pending)
  const isGm = controller.connection.isGm
  const tokenSkillsKey = token?.skills?.join('|') ?? '*'

  const labelOf = useMemo(() => (id: string) => rules?.pack.resources.find((r) => r.id === id)?.name ?? rules?.pack.attributes.find((a) => a.id === id)?.abbr ?? id, [rules])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const skills = useMemo(() => tokenSkillList(token, rules?.allSkills() ?? []), [rules, custom, tokenSkillsKey])

  // Evaluate non-numeric cost expressions against the sheet (most are literals).
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!rules || !character) { setAmounts({}); return }
    let live = true
    const next: Record<string, number> = {}
    const evals: Promise<void>[] = []
    for (const skill of skills) {
      for (const [i, cost] of (skill.cost ?? []).entries()) {
        const key = `${skill.id}:${i}`
        const n = Number(cost.amount)
        if (cost.amount.trim() !== '' && Number.isFinite(n)) { next[key] = n; continue }
        evals.push(rules.evaluate(cost.amount, character).then((v) => { if (typeof v === 'number') next[key] = v }, () => {}))
      }
    }
    setAmounts({ ...next })
    if (evals.length) void Promise.all(evals).then(() => { if (live) setAmounts({ ...next }) })
    return () => { live = false }
  }, [rules, character, skills])

  const canUse = !!token && !!character && (isGm || token.owner === controller.pubkey)
  const aiming = token && pending?.source === token.id ? pending.skillId : null

  return {
    skills,
    character,
    canUse,
    labelOf,
    aiming,
    shortfall: (skill) => (character ? skillShortfall(skill, character, amounts, labelOf) : 'no sheet'),
    use: (skill) => {
      if (!token || !character) return
      if (pending?.skillId === skill.id && pending.source === token.id) { useTargeting.getState().clear(); return }
      if (skill.target.kind === 'self') {
        useTargeting.getState().clear()
        useTargeting.getState().markFired()
        void controller.dispatch({ type: 'skill.use', skill: skill.id, source: token.id, targets: [token.id], seed: newSeed() })
        return
      }
      useTargeting.getState().start({ skillId: skill.id, name: skill.name, source: token.id as TokenId, shape: skill.target })
    },
  }
}

/** "free", or the costs: "1 WIL, 2 HP". */
export function costLabel(skill: SkillDef, labelOf: (id: string) => string): string {
  if (!skill.cost?.length) return 'free'
  return skill.cost.map((c) => `${c.amount} ${labelOf(c.resource)}`).join(', ')
}
