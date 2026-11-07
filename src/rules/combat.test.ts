import { beforeAll, describe, expect, it } from 'vitest'
import type { Character } from '@/core/doc'
import type { CharacterId } from '@/core/ids'
import type { ConditionDef, DamageModel } from '@/core/pack'
import { diceFromSeed, type ParsedFormula } from '@/dice/fair'
import { keptMask } from '@/dice/kept'
import { createRulesEngine } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { loadPack } from './load'
import { adjustForTraits, applyDamageChoice, damageTraits, heal, takeDamage } from './damage'
import { naturalDie, withAdvantage } from './rollMode'
import { fileFetch, loadMausritter } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadPack('packs/dnd5e/', fileFetch)
  engine = createRulesEngine(pack)
})

const seeds = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(4, '0').repeat(16))
async function dice(seed: string, sides: number[]): Promise<number[]> {
  const f: ParsedFormula = { terms: sides.map((s) => ({ count: 1, sides: s })), modifier: 0, raw: '' }
  return (await diceFromSeed(f, seed)).map((d) => d.value)
}
/** First seed whose first two d20s satisfy the predicate. */
async function seedWhere(pred: (a: number, b: number) => boolean): Promise<string> {
  for (const s of seeds) {
    const [a, b] = await dice(s, [20, 20])
    if (pred(a, b)) return s
  }
  throw new Error('no seed found')
}

function hero(id: string, name: string, extra: Record<string, unknown> = {}): Character {
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha']
  return {
    id: id as CharacterId,
    name,
    data: {
      ...Object.fromEntries(abilities.map((a) => [a, 10])),
      level: 1,
      save_prof: Object.fromEntries(abilities.map((a) => [a, 0])),
      prof: {},
      speed_base: 30,
      armor_base: 10,
      armor_dex_cap: 10,
      shield: 0,
      ac_bonus: 0,
      hp: { current: 20, max: 20 },
      temp_hp: 0,
      slots_1: { current: 2, max: 2 },
      caster: 'full',
      spell_ability: 'int',
      int: 16,
      melee: { name: 'Mace', damage: '1d6', ability: 'str', type: 'bludgeoning' },
      ranged: { name: 'Shortbow', damage: '1d6', ability: 'dex', type: 'piercing' },
      resistances: [],
      vulnerabilities: [],
      immunities: [],
      conditions: [],
      ...extra,
    },
  }
}

describe('withAdvantage', () => {
  it('doubles the first single d20 and keeps the better or worse', () => {
    expect(withAdvantage('d20 + dex_mod', 'advantage')).toBe('2d20kh1 + dex_mod')
    expect(withAdvantage('1d20+5', 'disadvantage')).toBe('2d20kl1+5')
    expect(withAdvantage('d20 >= 10', 'advantage')).toBe('2d20kh1 >= 10')
  })
  it('leaves rolls without a single d20 alone', () => {
    expect(withAdvantage('2d6 + 3', 'advantage')).toBeNull()
    expect(withAdvantage('2d20kh1', 'advantage')).toBeNull()
    expect(withAdvantage('d200', 'advantage')).toBeNull()
    expect(withAdvantage("roll('d20')", 'advantage')).toBeNull()
  })
  it('treats low as better for roll-under packs', () => {
    expect(withAdvantage('d20 <= str', 'advantage', { kind: 'roll-under', die: 'd20' })).toBe('2d20kl1 <= str')
    expect(withAdvantage('d20 <= str', 'disadvantage', { kind: 'roll-under', die: 'd20' })).toBe('2d20kh1 <= str')
  })
})

describe('naturalDie', () => {
  it('reads the kept die of a doubled d20 and the only die otherwise', () => {
    const d = [{ sides: 20, value: 4 }, { sides: 20, value: 17 }, { sides: 6, value: 3 }]
    expect(naturalDie('2d20kh1 + 1d6', d, 20)).toBe(17)
    expect(naturalDie('2d20kl1 + 1d6', d, 20)).toBe(4)
    expect(naturalDie('d20 + 1d6', d, 20)).toBe(4)
    expect(naturalDie('3d6', d, 20)).toBe(4)
    expect(naturalDie('3d6', [{ sides: 6, value: 1 }], 20)).toBeUndefined()
  })
})

describe('keptMask on sheet formulas', () => {
  it('strikes the dropped die of 2d20kh1 inside an expression', () => {
    expect(keptMask('2d20kh1 + dex_mod + pb', [{ value: 3 }, { value: 15 }])).toEqual([false, true])
    expect(keptMask('2d20kl1 + 1d4 + str_mod', [{ value: 3 }, { value: 15 }, { value: 2 }])).toEqual([true, false, true])
  })
})

describe('rolls with advantage (dnd5e)', () => {
  it('rewrites the formula, keeps the higher die and records the mode', async () => {
    const seed = await seedWhere((a, b) => a !== b && a < 20 && b < 20 && a > 1 && b > 1)
    const [a, b] = await dice(seed, [20, 20])
    const r = await engine.roll('d20 + 2', seed, { advantage: 'advantage' })
    expect(r.formula).toBe('2d20kh1 + 2')
    expect(r.advantage).toBe('advantage')
    expect(r.total).toBe(Math.max(a, b) + 2)
    const low = await engine.roll('d20 + 2', seed, { advantage: 'disadvantage' })
    expect(low.total).toBe(Math.min(a, b) + 2)
    // A damage roll is untouched and not marked.
    const dmg = await engine.roll('2d6', seed, { advantage: 'advantage' })
    expect(dmg.formula).toBe('2d6')
    expect(dmg.advantage).toBeUndefined()
  })
  it('reads criticals from the kept die', async () => {
    const seed = await seedWhere((a, b) => (a === 20) !== (b === 20) && a !== 1 && b !== 1)
    const adv = await engine.roll('d20', seed, { advantage: 'advantage' })
    const dis = await engine.roll('d20', seed, { advantage: 'disadvantage' })
    expect(adv.outcome?.critical).toBe(true)
    expect(dis.outcome?.critical).toBe(false)
  })
  it('applies to the attacker\'s roll in a skill, never to the targets\' saves', async () => {
    // Natural 20 kept from two dice: the attack crits even though the first die alone would not.
    const seed = await seedWhere((a, b) => a < 15 && a > 1 && b === 20)
    const r = await engine.resolveSkill('attack-melee', hero('pc', 'Brienne'), [hero('gob', 'Goblin', { armor_base: 30 })], seed, { advantage: 'advantage' })
    expect(r.messages[1]).toMatch(/^Goblin attack with advantage: \d+ \[\d+, 20\] vs 30 - (success|failure) \(critical\)\.$/)
    expect(r.damage?.[0].amount).toBeGreaterThan(0)
    const save = await engine.resolveSkill('burning-hands', hero('pc', 'Merlin'), [hero('gob', 'Goblin')], seed, { advantage: 'advantage' })
    expect(save.messages.some((m) => m.includes('with advantage'))).toBe(false)
  })
})

describe('damage math', () => {
  const model: DamageModel = { resource: 'hp', temp: 'temp_hp', resist: 'resistances', vulnerable: 'vulnerabilities', immune: 'immunities' }
  const conditions: ConditionDef[] = [{ id: 'petrified', name: 'Petrified', description: '', resist: ['all'], immune: ['poison'] }]
  it('collects traits from sheet lists and active conditions', () => {
    const t = damageTraits({ resistances: ['Fire'], vulnerabilities: ['cold'], conditions: ['petrified'] }, model, conditions)
    expect([...t.resist].sort()).toEqual(['all', 'fire'])
    expect([...t.vulnerable]).toEqual(['cold'])
    expect([...t.immune]).toEqual(['poison'])
    expect([...damageTraits({}, model, conditions, ['petrified']).resist]).toEqual(['all'])
  })
  it('immunity zeroes, resistance halves down, vulnerability doubles', () => {
    const traits = { resist: new Set(['fire']), vulnerable: new Set(['cold', 'fire']), immune: new Set(['poison']) }
    expect(adjustForTraits(9, 'poison', traits)).toEqual({ amount: 0, note: 'immune' })
    expect(adjustForTraits(9, 'cold', traits)).toEqual({ amount: 18, note: 'vulnerable' })
    expect(adjustForTraits(9, 'fire', traits)).toEqual({ amount: 8, note: 'resistant, vulnerable' })
    expect(adjustForTraits(9, undefined, traits)).toEqual({ amount: 9 })
  })
  it('spends temporary points first and never below zero', () => {
    const data: Record<string, unknown> = { hp: { current: 10, max: 20 }, temp_hp: 4 }
    expect(takeDamage(data, 'hp', 7, model)).toEqual([{ key: 'temp_hp', delta: -4 }, { key: 'hp', delta: -3 }])
    expect(data).toEqual({ hp: { current: 7, max: 20 }, temp_hp: 0 })
    expect(takeDamage(data, 'hp', 50, model)).toEqual([{ key: 'hp', delta: -7 }])
  })
  it('temporary points do not stack and do not heal hit points', () => {
    const data: Record<string, unknown> = { hp: { current: 10, max: 20 }, temp_hp: 6 }
    expect(heal(data, 'temp_hp', 5, model)).toEqual([])
    expect(heal(data, 'temp_hp', 8, model)).toEqual([{ key: 'temp_hp', delta: 2 }])
    expect(heal(data, 'hp', 50, model)).toEqual([{ key: 'hp', delta: 10 }])
  })
  it('applies a card choice, swaps it for another and undoes it exactly', () => {
    const start = { hp: { current: 20, max: 20 }, temp_hp: 3, resistances: ['fire'] }
    const full = applyDamageChoice(start, { amount: 10, factor: 1, type: 'fire', model, conditions: [] })
    expect(full.applied).toEqual({ factor: 1, amount: 5, note: 'resistant', changes: [{ key: 'temp_hp', delta: -3 }, { key: 'hp', delta: -2 }] })
    expect(full.data.hp).toEqual({ current: 18, max: 20 })
    const doubled = applyDamageChoice(full.data, { amount: 10, factor: 2, type: 'fire', previous: full.applied, model, conditions: [] })
    expect(doubled.applied?.amount).toBe(10)
    expect(doubled.data).toMatchObject({ hp: { current: 13 }, temp_hp: 0 })
    const undone = applyDamageChoice(doubled.data, { amount: 10, factor: 0, previous: doubled.applied, model, conditions: [] })
    expect(undone.applied).toBeUndefined()
    expect(undone.data).toEqual(start)
    const healed = applyDamageChoice(undone.data, { amount: 4, factor: -1, model, conditions: [] })
    expect(healed.applied).toEqual({ factor: -1, amount: 4, changes: [] })
  })
})

describe('dnd5e damage types, temporary hit points and durations', () => {
  it('declares a damage model and concentration', () => {
    expect(pack.manifest.damage?.resource).toBe('hp')
    expect(pack.manifest.damage?.types?.map((t) => t.id)).toContain('radiant')
    expect(pack.manifest.concentration?.condition).toBe('concentrating')
    expect(pack.conditions.find((c) => c.id === 'concentrating')?.category).toBe('magic')
    expect(pack.conditions.find((c) => c.id === 'petrified')?.resist).toEqual(['all'])
    expect(pack.conditions.every((c) => c.category)).toBe(true)
  })
  it('halves typed spell damage against a resistance and reports it', async () => {
    const r = await engine.resolveSkill('magic-missile', hero('pc', 'Merlin'), [hero('gob', 'Goblin', { resistances: ['force'] })], seeds[0])
    const d = r.damage![0]
    expect(d.type).toBe('force')
    expect(d.final).toBe(Math.floor(d.amount / 2))
    expect(r.messages.find((m) => m.startsWith('Goblin takes'))).toContain('force damage, resistant')
  })
  it('reads weapon damage types from the sheet and stays untyped without one', async () => {
    const seed = await seedWhere((a) => a === 20)
    const bone = hero('sk', 'Skeleton', { vulnerabilities: ['bludgeoning'] })
    const r = await engine.resolveSkill('attack-melee', hero('pc', 'Brienne'), [bone], seed)
    expect(r.damage![0]).toMatchObject({ type: 'bludgeoning', note: 'vulnerable' })
    expect(r.damage![0].final).toBe(r.damage![0].amount * 2)
    const old = hero('pc', 'Brienne', { melee: { name: 'Club', damage: '1d4', ability: 'str' } })
    const plain = await engine.resolveSkill('attack-melee', old, [bone], seed)
    expect(plain.damage![0].type).toBeUndefined()
  })
  it('lets temporary hit points soak damage first', async () => {
    const r = await engine.resolveSkill('magic-missile', hero('pc', 'Merlin'), [hero('gob', 'Goblin', { temp_hp: 50 })], seeds[0])
    const patch = r.patches.find((p) => p.character === 'gob')!.data
    expect(patch.hp).toBeUndefined()
    expect(patch.temp_hp).toBe(50 - r.damage![0].final)
    expect(r.messages.find((m) => m.startsWith('Goblin takes'))).toMatch(/absorbed by Temporary hit points|absorbed by temp_hp/)
  })
  it('False Life grants temporary hit points that do not stack', async () => {
    const caster = hero('pc', 'Merlin')
    const r = await engine.resolveSkill('false-life', caster, [caster], seeds[0])
    const temp = r.patches.find((p) => p.character === 'pc')!.data.temp_hp as number
    expect(temp).toBeGreaterThanOrEqual(5)
    expect(temp).toBeLessThanOrEqual(8)
    expect(r.damage).toEqual([expect.objectContaining({ heal: true, temp: true })])
    const again = await engine.resolveSkill('false-life', hero('pc', 'Merlin', { temp_hp: 20 }), [caster], seeds[0])
    expect(again.messages.some((m) => m.includes('does not stack'))).toBe(true)
  })
  it('reports added conditions with their durations, and the skill as concentration', async () => {
    const ally = hero('ally', 'Bob')
    const r = await engine.resolveSkill('shield-of-faith', hero('pc', 'Mirabel', { spell_ability: 'wis' }), [ally], seeds[0])
    expect(r.conditions).toEqual([{ target: 0, condition: 'shield-of-faith', duration: { turns: 100, on: 'source' } }])
    expect(pack.skills.find((s) => s.id === 'shield-of-faith')?.concentration).toBe(true)
  })
  it('validates durations, damage types and concentration in pack files', async () => {
    const { guardSkill, guardManifest, guardConditions } = await import('./load')
    const base = { id: 'x', name: 'X', description: '', target: { kind: 'self' }, vfx: [] }
    expect(() => guardSkill({ ...base, effects: [{ kind: 'condition', add: ['a'], duration: { turns: 0 } }] }, 'x.json')).toThrow(/turns/)
    expect(() => guardSkill({ ...base, effects: [{ kind: 'condition', add: ['a'], duration: { turns: 2, tick: 'noon' } }] }, 'x.json')).toThrow(/tick/)
    expect(() => guardSkill({ ...base, concentration: 'yes', effects: [] }, 'x.json')).toThrow(/concentration/)
    expect(() => guardConditions([{ id: 'a', name: 'A', description: '', category: 'good' }], 'c.json')).toThrow(/category/)
    const manifest = { id: 'p', name: 'P', version: '1', grid: { type: 'square', cellSize: 1 }, files: { attributes: 'a', resources: 'r', conditions: 'c', sheet: 's' } }
    expect(() => guardManifest({ ...manifest, damage: { temp: 'x' } })).toThrow(/resource/)
    expect(() => guardManifest({ ...manifest, concentration: { condition: 'c', save: 'd20 +', dc: '10' } })).toThrow(/concentration.save/)
    expect(guardManifest({ ...manifest, damage: { resource: 'hp', types: [{ id: 'fire', name: 'Fire' }] } }).damage?.resource).toBe('hp')
  })
})

describe('validating combat intents from players', () => {
  const me = 'bb'.repeat(32)
  const doc = {
    tokens: { mine: { id: 'mine', owner: me }, theirs: { id: 'theirs', owner: 'cc'.repeat(32) } },
    chat: [
      { id: 'r', kind: 'roll', roll: { total: 5 } },
      { id: 'say', kind: 'say' },
      { id: 'p', kind: 'system', concentration: { token: 'mine', dc: 10 } },
    ],
  }
  const actor = { isGm: false, pubkey: me }
  it('lets owners apply cards and roll or drop concentration for their own tokens', () => {
    expect(engine.validate({ type: 'damage.apply', message: 'r', token: 'mine' as never, factor: 1 }, actor, doc)).toBeNull()
    expect(engine.validate({ type: 'damage.apply', message: 'r', token: 'theirs' as never, factor: 1 }, actor, doc)).toMatch(/own/)
    expect(engine.validate({ type: 'damage.apply', message: 'say', token: 'mine' as never, factor: 1 }, actor, doc)).toMatch(/nothing to apply/)
    expect(engine.validate({ type: 'concentration.save', message: 'p', token: 'mine' as never, seed: 'x' }, actor, doc)).toBeNull()
    expect(engine.validate({ type: 'concentration.save', message: 'r', token: 'mine' as never, seed: 'x' }, actor, doc)).toMatch(/no open/)
    expect(engine.validate({ type: 'concentration.end', token: 'theirs' as never }, actor, doc)).toMatch(/own/)
  })
  it('keeps reveal and dismiss for the GM', () => {
    expect(engine.validate({ type: 'roll.reveal', message: 'r' }, actor, doc)).toMatch(/GM/)
    expect(engine.validate({ type: 'concentration.dismiss', message: 'p' }, actor, doc)).toMatch(/GM/)
    expect(engine.validate({ type: 'roll.reveal', message: 'r' }, { isGm: true, pubkey: 'aa' }, doc)).toBeNull()
  })
})

describe('advantage on a roll-under pack (Mausritter)', () => {
  it('keeps the lower die for advantage', async () => {
    const m = createRulesEngine(await loadMausritter())
    const seed = await seedWhere((a, b) => a !== b)
    const [a, b] = await dice(seed, [20, 20])
    const r = await m.roll('d20', seed, { advantage: 'advantage' })
    expect(r.formula).toBe('2d20kl1')
    expect(r.total).toBe(Math.min(a, b))
  })
})
