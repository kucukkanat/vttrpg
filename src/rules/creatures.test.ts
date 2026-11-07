import { beforeAll, describe, expect, it } from 'vitest'
import type { Character } from '@/core/doc'
import type { CharacterId } from '@/core/ids'
import { diceFromSeed } from '@/dice/fair'
import { createRulesEngine } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { compileActionSkills, creatureSkillPrefix, loadCreatures, sheetFor, type CreatureCompendium } from './creatures'
import { loadPack } from './load'
import { fileFetch, loadMausritter } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
let compendium: CreatureCompendium
beforeAll(async () => {
  pack = await loadPack('packs/dnd5e/', fileFetch)
  engine = createRulesEngine(pack)
  compendium = await loadCreatures(pack, fileFetch)
})

const seeds = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(4, '0').repeat(16))
async function seedWithD20(pred: (n: number) => boolean): Promise<string> {
  for (const s of seeds) {
    const [d] = await diceFromSeed({ terms: [{ count: 1, sides: 20 }], modifier: 0, raw: '' }, s)
    if (pred(d!.value)) return s
  }
  throw new Error('no seed')
}

function creature(name: string, source = 'srd-2024'): Character {
  const e = compendium.creatures.find((c) => c.name === name && c.source === source)
  if (!e) throw new Error(`no ${name}`)
  return { id: `npc-${e.key}` as CharacterId, name: e.name, sheet: 'npc', data: structuredClone(e.data) }
}

const hero: Character = {
  id: 'hero' as CharacterId,
  name: 'Hero',
  // An older sheet: no prof_bonus or initiative_bonus stored.
  data: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10, level: 5, armor_base: 10, armor_dex_cap: 10, shield: 0, ac_bonus: 0, save_prof: { str: 0, dex: 1, con: 0, int: 0, wis: 0, cha: 0 }, prof: {}, hp: { current: 40, max: 40 }, conditions: [] },
}

describe('dnd5e creature compendium', () => {
  it('loads the NPC layout, action templates and encounter budget with the pack', () => {
    expect(pack.sheets?.npc?.sections.map((s) => s.title)).toContain('Actions')
    expect(Object.keys(pack.creatureActions?.templates ?? {})).toEqual(['melee', 'ranged', 'save', 'save-only'])
    expect(pack.encounter?.bands.map((b) => b.id)).toEqual(['low', 'moderate', 'high'])
    expect(Object.keys(pack.encounter?.budget ?? {})).toHaveLength(20)
  })

  it('holds only CC-BY-4.0 SRD documents and tags every creature with one of them', () => {
    expect(compendium.documents.map((d) => d.key).sort()).toEqual(['srd-2014', 'srd-2024'])
    for (const d of compendium.documents) {
      expect(d.license).toBe('CC-BY-4.0')
      expect(d.attribution).toMatch(/Creative Commons Attribution 4\.0/)
    }
    expect(compendium.creatures.length).toBeGreaterThan(600)
    expect(new Set(compendium.creatures.map((c) => c.source))).toEqual(new Set(['srd-2014', 'srd-2024']))
    expect(new Set(compendium.creatures.map((c) => c.key)).size).toBe(compendium.creatures.length)
  })

  it('picks the creature layout for NPC sheets and the main sheet otherwise', () => {
    expect(sheetFor(pack, { sheet: 'npc' })).toBe(pack.sheets!.npc)
    expect(sheetFor(pack, {})).toBe(pack.sheet)
    expect(sheetFor(pack, { sheet: 'nope' })).toBe(pack.sheet)
  })

  it('reads stat-block numbers through the PC derived attributes', () => {
    const aboleth = creature('Aboleth')
    expect(engine.evaluateNow('ac', aboleth)).toBe(17)
    expect(engine.evaluateNow('pb', aboleth)).toBe(4)
    expect(engine.evaluateNow('initiative', aboleth)).toBe(7)
    expect(engine.evaluateNow('passive_perception', aboleth)).toBe(20)
    expect(engine.evaluateNow('dex_mod + save_prof.dex * pb', aboleth)).toBe(3)
    expect(engine.evaluateNow('int_mod + prof.history * pb', aboleth)).toBe(12)
  })

  it('keeps older PC sheets working: missing new attributes read as 0', () => {
    expect(engine.evaluateNow('pb', hero)).toBe(3)
    expect(engine.evaluateNow('initiative', hero)).toBe(2)
  })

  it('compiles attack actions into listed-only skills with their reach and range', () => {
    const goblin = creature('Goblin Warrior')
    const skills = compileActionSkills(pack, 'pack:srd-2024_goblin-warrior', goblin.data)
    expect(skills.map((s) => [s.id, s.name, s.target])).toEqual([
      [`${creatureSkillPrefix('pack:srd-2024_goblin-warrior')}0`, 'Scimitar', { kind: 'single', range: 1 }],
      [`${creatureSkillPrefix('pack:srd-2024_goblin-warrior')}1`, 'Shortbow', { kind: 'single', range: 16 }],
    ])
    expect(skills.every((s) => s.onlyListed)).toBe(true)
    expect(skills[0]!.effects[1]).toMatchObject({ kind: 'roll', formula: 'd20 + actions.0.bonus', vs: 'target.ac' })
  })

  it('a compiled attack hits on a natural 20 for doubled dice, reading the live sheet', async () => {
    const goblin = creature('Goblin Warrior')
    const [scimitar] = compileActionSkills(pack, 'pack:x', goblin.data)
    const seed = await seedWithD20((n) => n === 20)
    const r = await engine.resolveSkill(scimitar!, goblin, [hero], seed)
    const hp = r.patches.find((p) => p.character === 'hero')?.data.hp as { current: number }
    // 2d6 + 2 on a crit: between 4 and 14.
    expect(40 - hp.current).toBeGreaterThanOrEqual(4)
    expect(40 - hp.current).toBeLessThanOrEqual(14)
    expect(r.messages.join(' ')).toMatch(/Goblin Warrior uses Scimitar on Hero/)

    // Lowering the to-hit on the sheet changes the roll without recompiling.
    const miss = await seedWithD20((n) => n === 2)
    const weak = { ...goblin, data: { ...goblin.data, actions: [{ ...(goblin.data.actions as object[])[0], bonus: 0 }] } }
    const r2 = await engine.resolveSkill(scimitar!, weak, [hero], miss)
    expect(r2.patches.find((p) => p.character === 'hero')).toBeUndefined()
    expect(r2.messages.join(' ')).toMatch(/attack: 2 \[2\] vs 12 - failure/)
  })

  it('compiles a breath weapon into a cone save for half damage', async () => {
    const dragon = creature('Adult Red Dragon')
    const skills = compileActionSkills(pack, 'pack:red', dragon.data)
    const breath = skills.find((s) => s.name.startsWith('Fire Breath'))!
    expect(breath.target).toMatchObject({ kind: 'cone', range: 12, angle: 53 })
    const r = await engine.resolveSkill(breath, dragon, [hero], seeds[0]!)
    const text = r.messages.join(' ')
    expect(text).toMatch(/Hero save: \d+ \[\d+\] vs 21/)
    const damage = r.messages.find((m) => m.startsWith('Adult Red Dragon rolls damage'))!
    const rolled = Number(/damage: (\d+)/.exec(damage)![1])
    const hp = (r.patches.find((p) => p.character === 'hero')?.data.hp as { current: number }).current
    const taken = 40 - hp
    expect([rolled, Math.floor(rolled / 2)].map((n) => Math.min(40, n))).toContain(taken)
  })

  it('every compendium action with a template compiles to a valid skill', () => {
    let compiled = 0
    for (const c of compendium.creatures) {
      const actions = (c.data.actions as { kind: string }[]) ?? []
      const skills = compileActionSkills(pack, `pack:${c.key}`, c.data)
      compiled += skills.length
      expect(skills.length).toBe(actions.filter((a) => a.kind !== 'other').length)
      expect(engine.evaluateNow('ac', { id: 'x' as CharacterId, name: c.name, data: c.data })).toBe(c.data.armor_base)
    }
    expect(compiled).toBeGreaterThan(1000)
  })

  it('packs without creatures compile nothing and load an empty compendium', async () => {
    const maus = await loadMausritter()
    expect(compileActionSkills(maus, 'pack:x', { actions: [{ kind: 'melee' }] })).toEqual([])
    expect(await loadCreatures(maus, fileFetch)).toEqual({ documents: [], creatures: [] })
  })
})
