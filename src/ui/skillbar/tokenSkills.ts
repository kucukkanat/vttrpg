/**
 * Per-token skill lists. `token.skills` holds skill ids in bar order; a token without the field has
 * every skill (pack plus this game's custom skills), which is how tokens behaved before. The first
 * edit turns the implicit list into an explicit one. Skills marked `onlyListed` (a creature's
 * compiled stat-block actions) belong to the tokens that name them and are never implied or offered.
 */
import type { Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'

/** The skills `token` can use, in its order; ids that no longer resolve are skipped. */
export function tokenSkillList(token: Pick<Token, 'skills'> | undefined, all: readonly SkillDef[]): SkillDef[] {
  if (!token?.skills) return all.filter((s) => !s.onlyListed)
  const byId = new Map(all.map((s) => [s.id as string, s]))
  const out: SkillDef[] = []
  for (const id of token.skills) {
    const s = byId.get(id)
    if (s) out.push(s)
  }
  return out
}

/** Ids of the token's current skills (the implicit "all" made explicit). */
export function tokenSkillIds(token: Pick<Token, 'skills'>, all: readonly SkillDef[]): string[] {
  return tokenSkillList(token, all).map((s) => s.id as string)
}

/** The token's skill ids with `id` added at the end (no duplicate). */
export function withSkill(token: Pick<Token, 'skills'>, all: readonly SkillDef[], id: string): string[] {
  const ids = tokenSkillIds(token, all)
  return ids.includes(id) ? ids : [...ids, id]
}

/** The token's skill ids without `id`. */
export function withoutSkill(token: Pick<Token, 'skills'>, all: readonly SkillDef[], id: string): string[] {
  return tokenSkillIds(token, all).filter((s) => s !== id)
}

/** Skills the token does not have yet, for the "add" picker. */
export function missingSkills(token: Pick<Token, 'skills'>, all: readonly SkillDef[]): SkillDef[] {
  const have = new Set(tokenSkillIds(token, all))
  return all.filter((s) => !s.onlyListed && !have.has(s.id as string))
}
