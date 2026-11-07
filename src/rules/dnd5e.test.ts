import { beforeAll, describe, expect, it } from 'vitest'
import type { Character, GameDocShape, Token } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { CharacterId, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { diceFromSeed, type ParsedFormula } from '@/dice/fair'
import { createRulesEngine } from './engine'
import { BUILTIN_PACKS } from './impl'
import type { LoadedPack, RulesEngine } from './index'
import { guardAttributes, loadPack } from './load'
import { SEED_A, SEED_B, fileFetch } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadPack('packs/dnd5e/', fileFetch)
  engine = createRulesEngine(pack)
})

const SKILLS = [
  'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
  'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand', 'stealth', 'survival',
]
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
const zeros = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0]))
const seeds = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(4, '0').repeat(16))

/** Dice the engine will draw, in order, for a given list of sides. */
async function expectDice(seed: string, sides: number[]): Promise<number[]> {
  const f: ParsedFormula = { terms: sides.map((s) => ({ count: 1, sides: s })), modifier: 0, raw: '' }
  return (await diceFromSeed(f, seed)).map((d) => d.value)
}
/** First seed whose first d20 satisfies the predicate. */
async function seedWhere(pred: (natural: number) => boolean): Promise<string> {
  for (const s of seeds) if (pred((await expectDice(s, [20]))[0])) return s
  throw new Error('no seed found')
}

interface HeroOpts {
  scores: Partial<Record<(typeof ABILITIES)[number], number>>
  level: number
  hp: number
  hpMax: number
  armorBase: number
  armorDexCap: number
  shield: number
  slots1: number
  slots1Max: number
  caster: string
  spellAbility: string
  melee: { name: string; damage: string; ability: string }
  ranged: { name: string; damage: string; ability: string }
  prof: Record<string, number>
  saveProf: Record<string, number>
  conditions: string[]
}

function hero(id: string, name: string, o: Partial<HeroOpts> = {}, owner?: string): Character {
  return {
    id: id as CharacterId,
    name,
    owner: owner as Character['owner'],
    data: {
      ...zeros(ABILITIES),
      ...Object.fromEntries(ABILITIES.map((a) => [a, 10])),
      ...o.scores,
      level: o.level ?? 1,
      xp: 0,
      save_prof: { ...zeros(ABILITIES), ...o.saveProf },
      prof: { ...zeros(SKILLS), ...o.prof },
      speed_base: 30,
      armor_base: o.armorBase ?? 10,
      armor_dex_cap: o.armorDexCap ?? 10,
      shield: o.shield ?? 0,
      ac_bonus: 0,
      hp: { current: o.hp ?? 20, max: o.hpMax ?? o.hp ?? 20 },
      hit_dice: { current: o.level ?? 1, max: o.level ?? 1 },
      hit_die: 'd8',
      hit_die_sides: 8,
      slots_1: { current: o.slots1 ?? 2, max: o.slots1Max ?? 2 },
      slots_2: { current: 0, max: 0 },
      slots_3: { current: 0, max: 0 },
      caster: o.caster ?? 'none',
      spell_ability: o.spellAbility ?? 'none',
      melee: o.melee ?? { name: 'Longsword', damage: '1d8', ability: 'str' },
      ranged: o.ranged ?? { name: 'Shortbow', damage: '1d6', ability: 'dex' },
      attacks: [],
      spells: [],
      equipment: [],
      features: [],
      conditions: o.conditions ?? [],
      notes: '',
    },
  }
}

const fighter = () => hero('fighter', 'Brienne', { scores: { str: 16, dex: 14, con: 14 }, armorBase: 16, armorDexCap: 0, shield: 2 })
const wizard = (level = 1) => hero('wizard', 'Merlin', { scores: { int: 16, dex: 12 }, level, caster: 'full', spellAbility: 'int' })
const cleric = () => hero('cleric', 'Mirabel', { scores: { wis: 16 }, caster: 'full', spellAbility: 'wis' })
const goblin = (id = 'goblin', ac = 15, hp = 20, dex = 14) =>
  hero(id, `Goblin ${id}`, { scores: { dex }, armorBase: ac - Math.floor((dex - 10) / 2), hp })

const hp = (c: Character) => (c.data.hp as { current: number }).current
const patchFor = (r: { patches: { character: string; data: Record<string, unknown> }[] }, id: string) =>
  r.patches.find((p) => p.character === id)?.data

describe('pack', () => {
  it('loads from disk with the expected shape', () => {
    expect(pack.manifest.id).toBe('dnd5e')
    expect(pack.manifest.resolution).toEqual({ kind: 'd20-vs-dc' })
    expect(pack.manifest.grid).toEqual({ type: 'square', cellSize: 1.5 })
    expect(pack.attributes.map((a) => a.id)).toEqual(expect.arrayContaining([...ABILITIES, 'level', 'pb', 'ac', 'initiative', 'speed', 'passive_perception']))
    for (const a of ABILITIES) expect(pack.attributes.find((x) => x.id === `${a}_mod`)?.derived).toBe(`floor((${a} - 10) / 2)`)
    expect(pack.resources.map((r) => r.id)).toEqual(['hp', 'hit_dice', 'slots_1', 'slots_2', 'slots_3'])
    expect(pack.conditions.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible',
        'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
      ]),
    )
    expect(pack.skills.map((s) => s.id).sort()).toEqual(
      ['attack-melee', 'attack-ranged', 'burning-hands', 'cure-wounds', 'false-life', 'fire-bolt', 'healing-word', 'magic-missile', 'sacred-flame', 'shield-of-faith'],
    )
    const presets = new Set(pack.skills.flatMap((s) => s.vfx.map((v) => v.preset)))
    for (const p of ['hit', 'projectile', 'ring', 'aura', 'beam']) expect(presets.has(p as never), p).toBe(true)
    expect(pack.chargen?.steps.map((s) => s.id)).toEqual(['abilities', 'defaults', 'race', 'race-bonuses', 'class', 'background', 'alignment', 'vitals'])
    expect(Object.keys(pack.chargen!.tables.race.rows)).toHaveLength(9)
    expect(Object.keys(pack.chargen!.tables.class.rows)).toHaveLength(12)
  })

  it('is a built-in pack', () => {
    expect(BUILTIN_PACKS.find((p) => p.id === 'dnd5e')).toEqual({ id: 'dnd5e', name: 'D&D 5e (SRD)', url: 'packs/dnd5e/' })
  })

  it('every sheet roll formula and skill expression evaluates against a fixture', async () => {
    const c = { ...fighter(), data: { ...fighter().data, caster: 'full', spell_ability: 'int' } }
    for (const section of pack.sheet.sections)
      for (const f of section.fields)
        if (f.kind === 'roll') await expect(engine.evaluate(f.formula, c, { seed: SEED_A }), f.label).resolves.toBeDefined()
    for (const skill of pack.skills) {
      const r = await engine.resolveSkill(skill.id, c, [goblin()], SEED_A)
      expect(r.messages.length, skill.id).toBeGreaterThan(0)
    }
  })
})

describe('derived attributes', () => {
  it('computes modifiers, proficiency bonus and spell numbers', async () => {
    const f = fighter()
    expect(await engine.evaluate('str_mod', f)).toBe(3)
    expect(await engine.evaluate('dex_mod', f)).toBe(2)
    expect(await engine.evaluate('int_mod', hero('x', 'x', { scores: { int: 9 } }))).toBe(-1)
    expect(await engine.evaluate('pb', f)).toBe(2)
    expect(await engine.evaluate('pb', hero('x', 'x', { level: 5 }))).toBe(3)
    expect(await engine.evaluate('pb', hero('x', 'x', { level: 17 }))).toBe(6)
    expect(await engine.evaluate('initiative', f)).toBe(2)
    const w = wizard()
    expect(await engine.evaluate('spell_mod', w)).toBe(3)
    expect(await engine.evaluate('spell_attack', w)).toBe(5)
    expect(await engine.evaluate('spell_dc', w)).toBe(13)
    expect(await engine.evaluate('spell_mod', f)).toBe(0)
    expect(await engine.evaluate('cantrip_dice', wizard(4))).toBe(1)
    expect(await engine.evaluate('cantrip_dice', wizard(5))).toBe(2)
    expect(await engine.evaluate('cantrip_dice', wizard(17))).toBe(4)
    expect(await engine.evaluate('melee_mod', f)).toBe(3)
    expect(await engine.evaluate('ranged_mod', f)).toBe(2)
    expect(await engine.evaluate('melee_mod', hero('r', 'Rogue', { scores: { dex: 18 }, melee: { name: 'Rapier', damage: '1d8', ability: 'dex' } }))).toBe(4)
  })

  it('computes armor class from armor, dex cap and shield', async () => {
    expect(await engine.evaluate('ac', hero('u', 'Unarmored', { scores: { dex: 16 } }))).toBe(13)
    expect(await engine.evaluate('ac', hero('l', 'Leather', { scores: { dex: 16 }, armorBase: 11 }))).toBe(14)
    expect(await engine.evaluate('ac', hero('s', 'Scale', { scores: { dex: 16 }, armorBase: 14, armorDexCap: 2, shield: 2 }))).toBe(18)
    expect(await engine.evaluate('ac', fighter())).toBe(18)
    expect(await engine.evaluate('ac', hero('c', 'Clumsy', { scores: { dex: 6 }, armorBase: 16, armorDexCap: 0 }))).toBe(16)
  })

  it('applies condition modifiers to derived and base attributes', async () => {
    const blessed = hero('b', 'Blessed', { scores: { dex: 14 }, conditions: ['shield-of-faith'] })
    expect(await engine.evaluate('ac', blessed)).toBe(14)
    const held = hero('h', 'Held', { conditions: ['grappled'] })
    expect(await engine.evaluate('speed', held)).toBe(0)
    expect(await engine.evaluate('speed', hero('f', 'Free'))).toBe(30)
  })

  it('computes passive perception with proficiency and expertise', async () => {
    expect(await engine.evaluate('passive_perception', hero('a', 'A', { scores: { wis: 14 } }))).toBe(12)
    expect(await engine.evaluate('passive_perception', hero('b', 'B', { scores: { wis: 14 }, prof: { perception: 1 } }))).toBe(14)
    expect(await engine.evaluate('passive_perception', hero('c', 'C', { scores: { wis: 14 }, prof: { perception: 2 } }))).toBe(16)
  })

  it('rolls sheet checks and saves through the d20-vs-dc resolution', async () => {
    const f = fighter()
    const [n] = await expectDice(SEED_A, [20])
    const check = await engine.roll('d20 + str_mod', SEED_A, { character: f, dc: 15 })
    expect(check.total).toBe(n + 3)
    expect(check.outcome).toEqual({ critical: n === 1 || n === 20, target: 15, success: n + 3 >= 15 })
    const save = await engine.roll('d20 + con_mod + save_prof.con * pb', SEED_A, { character: { ...f, data: { ...f.data, save_prof: { ...zeros(ABILITIES), con: 1 } } } })
    expect(save.total).toBe(n + 2 + 2)
  })

  it('rejects self-referential derived attributes and dice in derived expressions', async () => {
    const loop = createRulesEngine({ ...pack, attributes: [...pack.attributes, { id: 'loop', name: 'Loop', derived: 'loop + 1' }] })
    await expect(loop.evaluate('loop', fighter())).rejects.toThrow(/depends on itself/)
    expect(() => guardAttributes([{ id: 'x', name: 'X', derived: 'd6 + 1' }], 'attributes.json')).toThrow(/must not roll dice/)
    expect(() => guardAttributes([{ id: 'x', name: 'X', derived: 'floor(1 / 2)' }], 'attributes.json')).not.toThrow()
  })
})

describe('generateCharacter (D&D 5e)', () => {
  const RACES = ['Hill Dwarf', 'High Elf', 'Lightfoot Halfling', 'Human', 'Dragonborn', 'Rock Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling']
  const CLASSES = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard']
  const stat = (c: Character, id: string) => c.data[id] as { current: number; max: number }

  it('is deterministic for a seed and differs across seeds', async () => {
    const a = await engine.generateCharacter(SEED_A, 'Brienne')
    expect(a).toEqual(await engine.generateCharacter(SEED_A, 'Brienne'))
    const b = await engine.generateCharacter(SEED_B, 'Brienne')
    expect(b.id).not.toBe(a.id)
    expect(b.data).not.toEqual(a.data)
    expect(a.id).toBe(`dnd5e-${SEED_A.slice(0, 12)}`)
    expect(a.name).toBe('Brienne')
  })

  it('rolls 4d6 drop lowest, applies racial bonuses and sets level 1 hit points from the class hit die', async () => {
    const racesSeen = new Set<string>()
    const classesSeen = new Set<string>()
    for (const seed of seeds.slice(0, 120)) {
      const c = await engine.generateCharacter(seed, 'Hero')
      const tables = pack.chargen!.tables
      const race = tables.race.rows[String(Object.values(tables.race.rows).findIndex((r) => r.race === c.data.race) + 1)]
      expect(RACES, seed).toContain(c.data.race)
      expect(CLASSES, seed).toContain(c.data.class)
      racesSeen.add(c.data.race as string)
      classesSeen.add(c.data.class as string)
      const bonus = race.race_bonus as Record<string, number>
      for (const a of ABILITIES) {
        const score = c.data[a] as number
        expect(score, `${seed} ${a}`).toBeGreaterThanOrEqual(3 + bonus[a])
        expect(score, `${seed} ${a}`).toBeLessThanOrEqual(18 + bonus[a])
      }
      expect(c.data.level).toBe(1)
      const sides = c.data.hit_die_sides as number
      expect(c.data.hit_die).toBe(`d${sides}`)
      expect([6, 8, 10, 12]).toContain(sides)
      const conMod = Math.floor(((c.data.con as number) - 10) / 2)
      expect(stat(c, 'hp')).toEqual({ current: sides + conMod, max: sides + conMod })
      expect(stat(c, 'hp').max).toBeGreaterThan(0)
      expect(stat(c, 'hit_dice')).toEqual({ current: 1, max: 1 })
      const caster = c.data.caster as string
      const slots = caster === 'full' ? 2 : caster === 'pact' ? 1 : 0
      expect(stat(c, 'slots_1'), `${seed} ${c.data.class}`).toEqual({ current: slots, max: slots })
      expect(stat(c, 'slots_2')).toEqual({ current: 0, max: 0 })
      expect(stat(c, 'slots_3')).toEqual({ current: 0, max: 0 })
      if (caster === 'none') expect(c.data.spell_ability).toBe('none')
      else expect(['int', 'wis', 'cha']).toContain(c.data.spell_ability)
      expect(c.data.background).toBe('Acolyte')
      expect(pack.chargen!.steps.find((s) => s.id === 'alignment')!.choose!.options).toContain(c.data.alignment)
      const prof = c.data.prof as Record<string, number>
      expect(Object.keys(prof).sort()).toEqual([...SKILLS].sort())
      for (const v of Object.values(prof)) expect([0, 1, 2]).toContain(v)
      expect(prof.insight).toBe(1)
      expect(prof.religion).toBe(1)
      const saves = c.data.save_prof as Record<string, number>
      expect(Object.values(saves).filter((v) => v === 1)).toHaveLength(2)
      expect(c.data.inventory).toBeUndefined()
      expect((c.data.equipment as unknown[]).length).toBeGreaterThan(6)
      expect((c.data.features as unknown[]).length).toBeGreaterThan(1)
      expect(c.data.conditions).toEqual([])
      const dexMod = Math.floor(((c.data.dex as number) - 10) / 2)
      const cap = c.data.armor_dex_cap as number
      expect(await engine.evaluate('ac', c)).toBe((c.data.armor_base as number) + (cap === 0 ? 0 : Math.min(dexMod, cap)) + (c.data.shield as number))
      expect(await engine.evaluate('pb', c)).toBe(2)
    }
    expect([...racesSeen].sort()).toEqual([...RACES].sort())
    expect([...classesSeen].sort()).toEqual([...CLASSES].sort())
  })

  it('gives each class its hit die, saves and casting type', async () => {
    const rows = Object.values(pack.chargen!.tables.class.rows)
    const byName = Object.fromEntries(rows.map((r) => [r.class as string, r]))
    expect(byName.Barbarian.hit_die_sides).toBe(12)
    expect(byName.Wizard.hit_die_sides).toBe(6)
    expect(byName.Fighter.save_prof).toEqual({ str: 1, dex: 0, con: 1, int: 0, wis: 0, cha: 0 })
    expect(rows.filter((r) => r.caster === 'full').map((r) => r.class).sort()).toEqual(['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'])
    expect(rows.filter((r) => r.caster === 'half').map((r) => r.class).sort()).toEqual(['Paladin', 'Ranger'])
    expect(byName.Warlock.caster).toBe('pact')
  })
})

describe('attacks', () => {
  it('melee: hits when d20 + STR mod + proficiency meets the target AC and deals weapon dice + STR', async () => {
    // Brienne attacks at +5 (STR 16, proficiency +2) against AC 15: a natural 10 or more hits.
    const hitSeed = await seedWhere((n) => n >= 10 && n < 20)
    const [n, d8] = await expectDice(hitSeed, [20, 8])
    const r = await engine.resolveSkill('attack-melee', fighter(), [goblin()], hitSeed)
    expect(r.messages[0]).toBe('Brienne swings Longsword at Goblin goblin.')
    expect(r.messages[1]).toBe(`Goblin goblin attack: ${n + 5} [${n}] vs 15 - success.`)
    expect(patchFor(r, 'goblin')).toEqual({ hp: { current: 20 - (d8 + 3), max: 20 } })
    expect(r.messages[2]).toBe(`Goblin goblin takes ${d8 + 3} damage (Hit points 20 to ${20 - d8 - 3}).`)
    expect(patchFor(r, 'fighter')).toBeUndefined()
    expect(r.vfx.map((v) => v.preset)).toEqual(['hit'])
  })

  it('melee: misses below the AC and leaves the target untouched', async () => {
    const missSeed = await seedWhere((n) => n > 1 && n < 10)
    const [n] = await expectDice(missSeed, [20])
    const target = goblin()
    const r = await engine.resolveSkill('attack-melee', fighter(), [target], missSeed)
    expect(r.messages[1]).toBe(`Goblin goblin attack: ${n + 5} [${n}] vs 15 - failure.`)
    expect(r.patches).toEqual([])
    expect(r.messages[2]).toMatch(/takes 0 damage/)
    expect(hp(target)).toBe(20)
  })

  it('melee: a natural 20 always hits and doubles the weapon dice, a natural 1 always misses', async () => {
    const critSeed = await seedWhere((n) => n === 20)
    const [, d8a, d8b] = await expectDice(critSeed, [20, 8, 8])
    const crit = await engine.resolveSkill('attack-melee', fighter(), [goblin('tough', 30)], critSeed)
    expect(crit.messages[1]).toMatch(/\(critical\)\.$/)
    expect(patchFor(crit, 'tough')).toEqual({ hp: { current: 20 - (d8a + d8b + 3), max: 20 } })
    const fumbleSeed = await seedWhere((n) => n === 1)
    const fumble = await engine.resolveSkill('attack-melee', fighter(), [goblin('weak', 2)], fumbleSeed)
    expect(fumble.messages[1]).toMatch(/vs 2 - success \(critical\)\.$/)
    expect(fumble.patches).toEqual([])
  })

  it('reports a natural-20 hit as a crit on the target for the table, and nothing else', async () => {
    const critSeed = await seedWhere((n) => n === 20)
    expect((await engine.resolveSkill('attack-melee', fighter(), [goblin('tough', 30)], critSeed)).crits).toEqual(['tough'])
    const hitSeed = await seedWhere((n) => n >= 10 && n < 20)
    expect((await engine.resolveSkill('attack-melee', fighter(), [goblin()], hitSeed)).crits).toBeUndefined()
    const fumbleSeed = await seedWhere((n) => n === 1)
    expect((await engine.resolveSkill('attack-melee', fighter(), [goblin('weak', 2)], fumbleSeed)).crits).toBeUndefined()
  })

  it('ranged: uses DEX and the readied ranged weapon', async () => {
    // +4 (DEX 14, proficiency +2) against AC 12: a natural 8 or more hits.
    const hitSeed = await seedWhere((n) => n >= 8 && n < 20)
    const [n, d6] = await expectDice(hitSeed, [20, 6])
    const r = await engine.resolveSkill('attack-ranged', fighter(), [goblin('far', 12)], hitSeed)
    expect(r.messages[0]).toBe('Brienne fires Shortbow at Goblin far.')
    expect(r.messages[1]).toBe(`Goblin far attack: ${n + 4} [${n}] vs 12 - success.`)
    expect(patchFor(r, 'far')).toEqual({ hp: { current: 20 - (d6 + 2), max: 20 } })
    expect(r.vfx.map((v) => v.preset)).toEqual(['projectile', 'hit'])
    const thrown = hero('barb', 'Grok', { scores: { str: 18 }, ranged: { name: 'Javelin', damage: '1d6', ability: 'str' } })
    const t = await engine.resolveSkill('attack-ranged', thrown, [goblin('far', 12)], hitSeed)
    expect(t.messages[1]).toBe(`Goblin far attack: ${n + 6} [${n}] vs 12 - success.`)
  })

  it('validate lets a player attack from an owned token without any cost', () => {
    const alice = 'a1'.repeat(32) as PlayerPubkey
    const doc = docWith({ 't-a': [alice, fighter()] })
    expect(engine.validate(use('attack-melee', 't-a', ['t-a']), { isGm: false, pubkey: alice }, doc)).toBeNull()
  })
})

describe('fire bolt', () => {
  it('is a spell attack against AC for 1d10, no slot spent', async () => {
    // Merlin attacks at +5 against AC 13: a natural 8 or more hits.
    const hitSeed = await seedWhere((n) => n >= 8 && n < 20)
    const [n, d10] = await expectDice(hitSeed, [20, 10])
    const r = await engine.resolveSkill('fire-bolt', wizard(), [goblin('g', 13)], hitSeed)
    expect(r.messages[0]).toBe(`Goblin g spell attack: ${n + 5} [${n}] vs 13 - success.`)
    expect(patchFor(r, 'g')).toEqual({ hp: { current: 20 - d10, max: 20 } })
    expect(patchFor(r, 'wizard')).toBeUndefined()
    expect(r.messages.at(-1)).toBe("Merlin's fire bolt scorches Goblin g.")
    const missSeed = await seedWhere((n) => n > 1 && n < 8)
    const miss = await engine.resolveSkill('fire-bolt', wizard(), [goblin('g', 13)], missSeed)
    expect(miss.patches).toEqual([])
    expect(miss.messages.at(-1)).toBe("Merlin's fire bolt streaks past Goblin g.")
  })

  it('scales to 2d10 at 5th level', async () => {
    const hitSeed = await seedWhere((n) => n >= 8 && n < 20)
    const [, a, b] = await expectDice(hitSeed, [20, 10, 10])
    const r = await engine.resolveSkill('fire-bolt', wizard(5), [goblin('g', 13, 40)], hitSeed)
    expect(patchFor(r, 'g')).toEqual({ hp: { current: 40 - a - b, max: 40 } })
  })
})

describe('magic missile', () => {
  it('deals 3d4 + 3 force damage and spends a 1st-level slot', async () => {
    const [a, b, c] = await expectDice(SEED_A, [4, 4, 4])
    const dmg = a + b + c + 3
    const r = await engine.resolveSkill('magic-missile', wizard(), [goblin()], SEED_A)
    expect(patchFor(r, 'wizard')).toEqual({ slots_1: { current: 1, max: 2 } })
    expect(patchFor(r, 'goblin')).toEqual({ hp: { current: 20 - dmg, max: 20 } })
    expect(r.messages).toEqual([
      'Merlin spends 1 1st-level slot on Magic Missile.',
      `Merlin rolls darts: ${dmg} [${a}, ${b}, ${c}].`,
      `Goblin goblin takes ${dmg} force damage (Hit points 20 to ${20 - dmg}).`,
      'Three darts of force from Merlin strike Goblin goblin.',
    ])
    expect(r.vfx.map((v) => v.preset)).toEqual(['beam', 'beam', 'beam', 'hit'])
  })

  it('refuses to resolve without a slot', async () => {
    const spent = hero('w', 'Spent', { caster: 'full', spellAbility: 'int', slots1: 0 })
    await expect(engine.resolveSkill('magic-missile', spent, [goblin()], SEED_A)).rejects.toThrow(/cannot pay 1 1st-level slot/)
  })
})

describe('spell slot costs in validate', () => {
  const alice = 'a1'.repeat(32) as PlayerPubkey
  const asAlice = { isGm: false, pubkey: alice }

  it('rejects slot spells from a caster with no slots left and allows cantrips', () => {
    const doc = docWith({
      't-full': [alice, hero('c-full', 'Full', { caster: 'full', spellAbility: 'int', slots1: 2 })],
      't-spent': [alice, hero('c-spent', 'Spent', { caster: 'full', spellAbility: 'int', slots1: 0 })],
      't-target': [undefined, goblin()],
    })
    expect(engine.validate(use('magic-missile', 't-full', ['t-target']), asAlice, doc)).toBeNull()
    expect(engine.validate(use('magic-missile', 't-spent', ['t-target']), asAlice, doc)).toBe('not enough 1st-level slot (0/1)')
    expect(engine.validate(use('cure-wounds', 't-spent', ['t-full']), asAlice, doc)).toMatch(/not enough 1st-level slot/)
    expect(engine.validate(use('burning-hands', 't-spent', ['t-target']), asAlice, doc)).toMatch(/not enough 1st-level slot/)
    expect(engine.validate(use('fire-bolt', 't-spent', ['t-target']), asAlice, doc)).toBeNull()
    expect(engine.validate(use('sacred-flame', 't-spent', ['t-target']), asAlice, doc)).toBeNull()
    expect(engine.validate(use('magic-missile', 't-full', ['t-target', 't-spent']), asAlice, doc)).toMatch(/single/)
  })

  it('every slot spell costs exactly one 1st-level slot', () => {
    for (const id of ['magic-missile', 'burning-hands', 'cure-wounds', 'healing-word', 'shield-of-faith'])
      expect(pack.skills.find((s) => s.id === id)!.cost, id).toEqual([{ resource: 'slots_1', amount: '1' }])
    for (const id of ['attack-melee', 'attack-ranged', 'fire-bolt', 'sacred-flame']) expect(pack.skills.find((s) => s.id === id)!.cost, id).toBeUndefined()
  })
})

describe('cure wounds and healing word', () => {
  it('cure wounds heals 1d8 + spellcasting modifier up to the maximum and spends a slot', async () => {
    const [d8] = await expectDice(SEED_A, [8])
    const wounded = hero('w', 'Wounded', { hp: 2, hpMax: 15 })
    const r = await engine.resolveSkill('cure-wounds', cleric(), [wounded], SEED_A)
    const healed = Math.min(15, 2 + d8 + 3)
    expect(patchFor(r, 'cleric')).toEqual({ slots_1: { current: 1, max: 2 } })
    expect(patchFor(r, 'w')).toEqual({ hp: { current: healed, max: 15 } })
    expect(r.messages).toEqual([
      'Mirabel spends 1 1st-level slot on Cure Wounds.',
      'Mirabel lays hands on Wounded.',
      `Wounded recovers ${healed - 2} Hit points (2 to ${healed}).`,
    ])
    expect(r.vfx.map((v) => v.preset)).toEqual(['aura', 'ring'])
    const full = await engine.resolveSkill('cure-wounds', cleric(), [hero('f', 'Full', { hp: 15 })], SEED_A)
    expect(patchFor(full, 'f')).toBeUndefined()
    expect(full.messages.at(-1)).toBe('Full recovers 0 Hit points (15 to 15).')
  })

  it('healing word heals 1d4 + spellcasting modifier at range', async () => {
    const [d4] = await expectDice(SEED_B, [4])
    const r = await engine.resolveSkill('healing-word', cleric(), [hero('w', 'Wounded', { hp: 1, hpMax: 20 })], SEED_B)
    expect(patchFor(r, 'w')).toEqual({ hp: { current: 1 + d4 + 3, max: 20 } })
    expect(patchFor(r, 'cleric')).toEqual({ slots_1: { current: 1, max: 2 } })
    expect(pack.skills.find((s) => s.id === 'healing-word')!.target).toEqual({ kind: 'single', range: 12 })
  })
})

describe('burning hands', () => {
  it('rolls 3d6 once; each creature in the cone saves DEX against the spell DC for half', async () => {
    const [a, b, c, s1, s2] = await expectDice(SEED_A, [6, 6, 6, 20, 20])
    const fire = a + b + c
    const nimble = hero('nimble', 'Nimble', { scores: { dex: 14 }, saveProf: { dex: 1 }, hp: 30 }) // save +4
    const slow = hero('slow', 'Slow', { scores: { dex: 8 }, hp: 30 }) // save -1
    const r = await engine.resolveSkill('burning-hands', wizard(), [nimble, slow], SEED_A)
    const dmg = (save: number) => (save >= 13 ? Math.floor(fire / 2) : fire)
    expect(patchFor(r, 'wizard')).toEqual({ slots_1: { current: 1, max: 2 } })
    expect(patchFor(r, 'nimble')).toEqual({ hp: { current: 30 - dmg(s1 + 4), max: 30 } })
    expect(patchFor(r, 'slow')).toEqual({ hp: { current: 30 - dmg(s2 - 1), max: 30 } })
    expect(r.messages[1]).toBe(`Merlin rolls fire: ${fire} [${a}, ${b}, ${c}].`)
    expect(r.messages[2]).toMatch(new RegExp(`^Nimble DEX save: ${s1 + 4} \\[${s1}\\] vs 13 - (success|failure)`))
    expect(r.messages[3]).toMatch(new RegExp(`^Slow DEX save: ${s2 - 1} \\[${s2}\\] vs 13 - (success|failure)`))
    expect(r.messages.at(-1)).toBe("Flames fan out from Merlin's fingertips.")
    expect(pack.skills.find((s) => s.id === 'burning-hands')!.target).toEqual({ kind: 'cone', range: 3, angle: 53 })
  })
})

describe('sacred flame', () => {
  it('deals 1d8 only on a failed DEX save and costs nothing', async () => {
    // Mirabel's DC is 13; the goblin saves at +2, so a natural 11 or more succeeds.
    const failSeed = await seedWhere((n) => n < 11)
    const [, d8] = await expectDice(failSeed, [20, 8])
    const fail = await engine.resolveSkill('sacred-flame', cleric(), [goblin()], failSeed)
    expect(patchFor(fail, 'goblin')).toEqual({ hp: { current: 20 - d8, max: 20 } })
    expect(patchFor(fail, 'cleric')).toBeUndefined()
    const saveSeed = await seedWhere((n) => n >= 11)
    const saved = await engine.resolveSkill('sacred-flame', cleric(), [goblin()], saveSeed)
    expect(saved.patches).toEqual([])
    expect(saved.messages.at(-1)).toBe('Radiance falls on Goblin goblin.')
  })
})

describe('shield of faith', () => {
  it('adds the condition, which raises the target AC by 2 while present', async () => {
    const ally = hero('ally', 'Bob', { scores: { dex: 14 } })
    const r = await engine.resolveSkill('shield-of-faith', cleric(), [ally], SEED_A)
    expect(patchFor(r, 'ally')).toEqual({ conditions: ['shield-of-faith'] })
    expect(patchFor(r, 'cleric')).toEqual({ slots_1: { current: 1, max: 2 } })
    expect(r.messages).toEqual([
      'Mirabel spends 1 1st-level slot on Shield of Faith.',
      'Bob is now Shield of Faith for 100 turns.',
      'A shimmering field surrounds Bob (AC 14).',
    ])
    expect(await engine.evaluate('ac', ally)).toBe(12)
    expect(await engine.evaluate('ac', { ...ally, data: { ...ally.data, ...patchFor(r, 'ally') } })).toBe(14)
    expect(r.vfx.map((v) => v.preset)).toEqual(['ring', 'aura'])
  })
})

// ------------------------------------------------------------------ fixtures

const scene = 's1' as SceneId
function docWith(tokens: Record<string, [PlayerPubkey | undefined, Character]>): GameDocShape {
  const gm = 'gm'.repeat(32) as PlayerPubkey
  const doc: GameDocShape = {
    meta: { name: 'g', gm, pack: 'dnd5e' as never, activeScene: scene, createdAt: 0 },
    events: [],
    props: {},
    notes: {},
    customSkills: {},
    scenes: {},
    tokens: {},
    characters: {},
    chat: [],
    fog: {},
  }
  for (const [id, [owner, character]] of Object.entries(tokens)) {
    const token: Token = {
      id: id as TokenId, scene, name: id, owner, character: character.id,
      color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [],
    }
    doc.tokens[token.id] = token
    doc.characters[character.id] = { ...character, owner }
  }
  return doc
}
const use = (skill: string, source: string, targets: string[] = []): Intent => ({
  type: 'skill.use', skill: skill as never, source: source as TokenId, targets: targets as TokenId[], seed: SEED_A,
})
