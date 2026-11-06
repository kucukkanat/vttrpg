import { beforeAll, describe, expect, it } from 'vitest'
import type { Character } from '@/core/doc'
import type { SkillId } from '@/core/ids'
import { diceFromSeed, type ParsedFormula } from '@/dice/fair'
import { createRulesEngine } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { SEED_A, SEED_B, loadMausritter, mouse } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadMausritter()
  engine = createRulesEngine(pack)
})

/** Dice the engine will draw, in order, for a given list of sides. */
async function expectDice(seed: string, sides: number[]): Promise<number[]> {
  const f: ParsedFormula = { terms: sides.map((s) => ({ count: 1, sides: s })), modifier: 0, raw: '' }
  return (await diceFromSeed(f, seed)).map((d) => d.value)
}

const hp = (c: Character) => (c.data.hp as { current: number }).current
const wil = (c: Character) => (c.data.wil as { current: number }).current
const patchFor = (r: { patches: { character: string; data: Record<string, unknown> }[] }, id: string) =>
  r.patches.find((p) => p.character === id)?.data

const caster = () => mouse('caster', 'Hazel', { wil: 7, hp: 5, items: [{ name: 'Needle', damage: 'd6', slot: 'paw' }] })
const rat = (id = 'rat', dex = 8) => mouse(id, `Rat ${id}`, { dex, hp: 10, items: [null, null, { name: 'Bark plate', armor: 1, slot: 'body' }] })

describe('fireball', () => {
  it('rolls power once, each target saves vs DEX for half, and the caster pays 1 WIL', async () => {
    const src = caster()
    const targets = [rat('r1', 8), rat('r2', 12)]
    const r = await engine.resolveSkill('fireball', src, targets, SEED_A)
    const [p1, p2, s1, s2] = await expectDice(SEED_A, [6, 6, 20, 20])
    const power = p1 + p2
    const dmg = (save: number, dex: number) => (save <= dex ? Math.floor(power / 2) : power)

    expect(patchFor(r, 'caster')).toEqual({ wil: { current: 6, max: 7 } })
    expect(patchFor(r, 'r1')).toEqual({ hp: { current: Math.max(0, 10 - dmg(s1, 8)), max: 10 } })
    expect(patchFor(r, 'r2')).toEqual({ hp: { current: Math.max(0, 10 - dmg(s2, 12)), max: 10 } })
    expect(r.messages[0]).toBe('Hazel spends 1 Willpower on Fireball.')
    expect(r.messages[1]).toBe(`Hazel rolls power: ${power} [${p1}, ${p2}].`)
    expect(r.messages[2]).toMatch(new RegExp(`^Rat r1 DEX save: ${s1} \\[${s1}\\] vs 8 - (success|failure)`))
    expect(r.messages.at(-1)).toBe('The fireball cast by Hazel gutters out, leaving the ground blackened.')
    expect(r.vfx).toBe(pack.skills.find((s) => s.id === 'fireball')!.vfx)
    // inputs are untouched
    expect(wil(src)).toBe(7)
    expect(hp(targets[0])).toBe(10)
  })

  it('is deterministic and seed-dependent', async () => {
    const a = await engine.resolveSkill('fireball', caster(), [rat()], SEED_A)
    const b = await engine.resolveSkill('fireball', caster(), [rat()], SEED_A)
    const c = await engine.resolveSkill('fireball', caster(), [rat()], SEED_B)
    expect(a).toEqual(b)
    expect(a.messages[1]).not.toBe(c.messages[1])
  })

  it('refuses when the caster cannot pay', async () => {
    await expect(engine.resolveSkill('fireball', mouse('x', 'Empty', { wil: 0 }), [rat()], SEED_A)).rejects.toThrow(/cannot pay 1 Willpower/)
  })
})

describe('magic missile', () => {
  it('deals d6+2 to one target ignoring armor', async () => {
    const src = caster()
    const target = rat()
    const r = await engine.resolveSkill('magic-missile', src, [target], SEED_A)
    const [d] = await expectDice(SEED_A, [6])
    expect(patchFor(r, 'rat')).toEqual({ hp: { current: 10 - (d + 2), max: 10 } })
    expect(patchFor(r, 'caster')).toEqual({ wil: { current: 6, max: 7 } })
    expect(r.messages).toEqual([
      'Hazel spends 1 Willpower on Magic Missile.',
      `Hazel rolls power: ${d + 2} [${d}].`,
      `Rat rat takes ${d + 2} damage (Hit Protection 10 to ${10 - d - 2}).`,
      'The missile from Hazel finds Rat rat; armor is no help.',
    ])
    expect(r.vfx.map((v) => v.preset)).toEqual(['beam', 'hit'])
  })

  it('floors Hit Protection at zero and says so', async () => {
    const r = await engine.resolveSkill('magic-missile', caster(), [mouse('weak', 'Weak', { hp: 2 })], SEED_A)
    expect(patchFor(r, 'weak')).toEqual({ hp: { current: 0, max: 2 } })
    expect(r.messages[2]).toMatch(/Hit Protection depleted\.$/)
  })
})

describe('heal', () => {
  it('restores 2d6 up to the maximum', async () => {
    const [a, b] = await expectDice(SEED_A, [6, 6])
    const wounded = mouse('w', 'Wounded', { hp: 1, hpMax: 6 })
    const r = await engine.resolveSkill('heal', caster(), [wounded], SEED_A)
    const expected = Math.min(6, 1 + a + b)
    expect(patchFor(r, 'w')).toEqual({ hp: { current: expected, max: 6 } })
    expect(r.messages).toContain(`Wounded recovers ${expected - 1} Hit Protection (1 to ${expected}).`)
    expect(r.messages[1]).toBe('Hazel lays a paw on Wounded and the bleeding slows.')
    const full = await engine.resolveSkill('heal', caster(), [mouse('f', 'Full', { hp: 6 })], SEED_A)
    expect(patchFor(full, 'f')).toBeUndefined()
    expect(full.messages).toContain('Full recovers 0 Hit Protection (6 to 6).')
  })
})

describe('attack', () => {
  it('rolls the equipped weapon and subtracts armor', async () => {
    const r = await engine.resolveSkill('attack', caster(), [rat()], SEED_A)
    const [d] = await expectDice(SEED_A, [6])
    const dmg = Math.max(0, d - 1)
    expect(r.messages[0]).toBe('Hazel attacks Rat rat with Needle.')
    expect(r.messages[1]).toBe(`Hazel rolls damage: ${d} [${d}].`)
    if (dmg > 0) expect(patchFor(r, 'rat')).toEqual({ hp: { current: 10 - dmg, max: 10 } })
    else expect(patchFor(r, 'rat')).toBeUndefined()
    expect(patchFor(r, 'caster')).toBeUndefined()
  })

  it('uses d4 when unarmed and heavy weapons when carried', async () => {
    const bare = await engine.resolveSkill('attack', mouse('b', 'Bare'), [rat()], SEED_A)
    const [d4] = await expectDice(SEED_A, [4])
    expect(bare.messages[0]).toBe('Bare attacks Rat rat with Unarmed.')
    expect(bare.messages[1]).toBe(`Bare rolls damage: ${d4} [${d4}].`)
    const spear = mouse('s', 'Spear', { items: [{ name: 'Spear', damage: 'd10', size: 2, slot: 'paw' }, { continuationOf: 0 }] })
    const heavy = await engine.resolveSkill('attack', spear, [rat()], SEED_A)
    const [d10] = await expectDice(SEED_A, [10])
    expect(heavy.messages[1]).toBe(`Spear rolls damage: ${d10} [${d10}].`)
  })
})

describe('effect rows', () => {
  const withSkill = (effects: unknown[], cost?: unknown[]) =>
    createRulesEngine({
      ...pack,
      skills: [
        ...pack.skills,
        { id: 'test' as SkillId, name: 'Test', description: '', target: { kind: 'single', range: 1 }, cost: cost as never, effects: effects as never, vfx: [] },
      ],
    })

  it('adds and removes conditions on targets, or the caster without targets', async () => {
    const e = withSkill([{ kind: 'condition', add: ['frightened', 'hungry'], remove: ['exhausted'] }])
    const t = mouse('t', 'Tim', { conditions: ['exhausted', 'hungry'] })
    const r = await e.resolveSkill('test', caster(), [t], SEED_A)
    expect(patchFor(r, 't')).toEqual({ conditions: ['hungry', 'frightened'] })
    expect(r.messages).toEqual(['Tim is no longer Exhausted.', 'Tim is now Frightened.'])
    const self = await e.resolveSkill('test', caster(), [], SEED_A)
    expect(patchFor(self, 'caster')).toEqual({ conditions: ['frightened', 'hungry'] })
  })

  it('rejects unknown conditions and skills', async () => {
    await expect(withSkill([{ kind: 'condition', add: ['cursed'] }]).resolveSkill('test', caster(), [rat()], SEED_A)).rejects.toThrow(/unknown condition/)
    await expect(engine.resolveSkill('nope', caster(), [], SEED_A)).rejects.toThrow(/unknown skill/)
  })

  it('exposes save results and last roll to later rows, and move/message rows', async () => {
    const e = withSkill([
      { kind: 'roll', formula: 'd20', vs: 'target.str', label: 'STR save' },
      { kind: 'damage', formula: 'save.success ? 0 : 3', resource: 'hp' },
      { kind: 'move', cells: 2 },
      { kind: 'message', text: '{source.name} shoves {target.name} (rolled {last.total} vs {last.target}).' },
    ])
    const t = rat('t', 8)
    const r = await e.resolveSkill('test', caster(), [t], SEED_A)
    const [d20] = await expectDice(SEED_A, [20])
    const saved = d20 <= 9
    expect(patchFor(r, 't')).toEqual(saved ? undefined : { hp: { current: 7, max: 10 } })
    expect(r.messages).toContain('Hazel moves 2 cells.')
    expect(r.messages.at(-1)).toBe(`Hazel shoves Rat t (rolled ${d20} vs 9).`)
  })

  it('skips saves and damage when an area skill catches nobody, but still pays the cost', async () => {
    const r = await engine.resolveSkill('fireball', caster(), [], SEED_A)
    expect(r.messages).toEqual(['Hazel spends 1 Willpower on Fireball.', 'Fireball hits no one.'])
    expect(patchFor(r, 'caster')).toEqual({ wil: { current: 6, max: 7 } })
    expect(r.patches).toHaveLength(1)
    expect(r.vfx).toBe(pack.skills.find((s) => s.id === 'fireball')!.vfx)
  })

  it('keeps the caster-as-target fallback for non-area skills', async () => {
    const e = withSkill([{ kind: 'roll', formula: 'd20', vs: 'target.str', label: 'STR save' }])
    const r = await e.resolveSkill('test', caster(), [], SEED_A)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]).toMatch(/^Hazel STR save: \d+ \[\d+\] vs 9/)
  })

  it('pays costs from dotted paths and evaluates cost expressions', async () => {
    const e = withSkill([], [{ resource: 'pips.current', amount: '1 + 1' }])
    const r = await e.resolveSkill('test', caster(), [], SEED_A)
    expect(patchFor(r, 'caster')).toEqual({ pips: { current: 1, max: 250 } })
    expect(r.messages).toEqual(['Hazel spends 2 pips.current on Test.'])
  })
})
