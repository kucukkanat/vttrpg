import { describe, expect, it } from 'vitest'
import type { SkillDef } from '@/core/pack'
import { missingSkills, tokenSkillIds, tokenSkillList, withoutSkill, withSkill } from './tokenSkills'

const skill = (id: string) => ({ id, name: id.toUpperCase(), target: { kind: 'self' }, effects: [] }) as unknown as SkillDef
const all = [skill('attack'), skill('heal'), skill('fireball')]

describe('token skills', () => {
  it('gives a token without a list every skill', () => {
    expect(tokenSkillIds({}, all)).toEqual(['attack', 'heal', 'fireball'])
  })
  it('keeps the token order and skips ids that no longer exist', () => {
    expect(tokenSkillList({ skills: ['fireball', 'gone', 'attack'] }, all).map((s) => s.id)).toEqual(['fireball', 'attack'])
  })
  it('makes the implicit list explicit on the first edit', () => {
    expect(withoutSkill({}, all, 'heal')).toEqual(['attack', 'fireball'])
    expect(withSkill({ skills: ['attack'] }, all, 'heal')).toEqual(['attack', 'heal'])
    expect(withSkill({ skills: ['attack'] }, all, 'attack')).toEqual(['attack'])
  })
  it('offers only the skills the token lacks', () => {
    expect(missingSkills({ skills: ['heal'] }, all).map((s) => s.id)).toEqual(['attack', 'fireball'])
    expect(missingSkills({}, all)).toEqual([])
  })
})
