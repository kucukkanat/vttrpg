import { beforeAll, describe, expect, it } from 'vitest'
import type { GameDocShape, Token } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PlayerPubkey, SceneId, SkillId, TokenId } from '@/core/ids'
import type { SkillDef } from '@/core/pack'
import { createRulesEngine } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { SEED_A, loadMausritter, mouse } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadMausritter()
})

const ids = (skills: SkillDef[]) => skills.map((s) => s.id as string)

const frostbolt: SkillDef = {
  id: 'frostbolt' as SkillId,
  name: 'Frostbolt',
  description: 'A shard of ice.',
  target: { kind: 'single', range: 6 },
  effects: [
    { kind: 'roll', formula: 'd6', label: 'power' },
    { kind: 'damage', formula: 'rolls.power.total', resource: 'hp' },
    { kind: 'message', text: '{source.name} chills {target.name}.' },
  ],
  vfx: [{ at: 0, preset: 'beam', from: 'source', to: 'target', color: '#8ab4ff' }],
}

describe('custom skills', () => {
  it('starts with the pack skills only', () => {
    engine = createRulesEngine(pack)
    expect(ids(engine.allSkills()).sort()).toEqual(ids(pack.skills).sort())
    expect(engine.allSkills()).toEqual(pack.skills)
  })

  it('appends new custom skills and makes them resolvable', async () => {
    engine = createRulesEngine(pack)
    engine.setCustomSkills([frostbolt])
    expect(ids(engine.allSkills())).toEqual([...ids(pack.skills), 'frostbolt'])
    const r = await engine.resolveSkill('frostbolt', mouse('a', 'Hazel'), [mouse('b', 'Rat', { hp: 10 })], SEED_A)
    expect(r.messages.at(-1)).toBe('Hazel chills Rat.')
    expect(r.patches.find((p) => p.character === 'b')).toBeTruthy()
    expect(r.vfx).toBe(frostbolt.vfx)
  })

  it('overrides a pack skill by id in place and leaves pack.skills untouched', async () => {
    engine = createRulesEngine(pack)
    const original = pack.skills.find((s) => s.id === 'heal')!
    const bigHeal: SkillDef = { ...original, name: 'Big Heal', effects: [{ kind: 'heal', formula: '20', resource: 'hp' }], vfx: [] }
    engine.setCustomSkills([bigHeal])

    const all = engine.allSkills()
    expect(ids(all)).toEqual(ids(pack.skills)) // same ids, same order
    expect(all.find((s) => s.id === 'heal')).toBe(bigHeal)
    expect(engine.pack.skills.find((s) => s.id === 'heal')).toBe(original)

    const r = await engine.resolveSkill('heal', mouse('a', 'Hazel', { wil: 5 }), [mouse('b', 'Rat', { hp: 1, hpMax: 10 })], SEED_A)
    expect(r.patches.find((p) => p.character === 'b')?.data).toEqual({ hp: { current: 10, max: 10 } })
    expect(r.vfx).toEqual([])
  })

  it('removing the custom set restores the pack version', async () => {
    engine = createRulesEngine(pack)
    const original = pack.skills.find((s) => s.id === 'heal')!
    engine.setCustomSkills([{ ...original, name: 'Big Heal' }, frostbolt])
    expect(engine.allSkills().find((s) => s.id === 'heal')?.name).toBe('Big Heal')

    engine.setCustomSkills([frostbolt])
    expect(engine.allSkills().find((s) => s.id === 'heal')).toBe(original)
    expect(ids(engine.allSkills())).toContain('frostbolt')

    engine.setCustomSkills([])
    expect(engine.allSkills()).toEqual(pack.skills)
    await expect(engine.resolveSkill('frostbolt', mouse('a', 'A'), [], SEED_A)).rejects.toThrow(/unknown skill/)
  })

  it('validate accepts skill.use of a custom skill for a player', () => {
    engine = createRulesEngine(pack)
    const player = 'p'.repeat(64) as PlayerPubkey
    const token: Token = {
      id: 't1' as TokenId, scene: 's1' as SceneId, name: 'Hazel', character: 'c1' as never, owner: player,
      color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [],
    }
    const doc = { tokens: { t1: token }, characters: { c1: mouse('c1', 'Hazel', {}, player) } } as unknown as GameDocShape
    const intent: Intent = { type: 'skill.use', skill: 'frostbolt' as SkillId, source: 't1' as TokenId, targets: [], seed: SEED_A }
    expect(engine.validate(intent, { isGm: false, pubkey: player }, doc)).toMatch(/unknown skill/)
    engine.setCustomSkills([frostbolt])
    expect(engine.validate(intent, { isGm: false, pubkey: player }, doc)).toBeNull()
  })

  it('resolveSkill dry-runs an unsaved SkillDef without registering it', async () => {
    engine = createRulesEngine(pack)
    const r = await engine.resolveSkill(frostbolt, mouse('a', 'Hazel'), [mouse('b', 'Rat')], SEED_A)
    expect(r.messages.at(-1)).toBe('Hazel chills Rat.')
    expect(ids(engine.allSkills())).not.toContain('frostbolt')
  })
})
