import { describe, expect, it } from 'vitest'
import type { Character, CreatureTemplate, Token } from '@/core/doc'
import type { CreatureConfig, CreatureEntry, EncounterRules } from '@/core/pack'
import type { CharacterId, TokenId } from '@/core/ids'
import {
  budgetFor, creatureSheetData, detectParty, difficultyArithmetic, difficultyLabel, encounterDifficulty, hpFormula, averageHp, mergeGroupInitiative,
  migrateLegacyEncounters, resolveCreature, rowName, sortEncounters, templateFrom, tokenNames, newRow,
} from './encounters'

const CONFIG: CreatureConfig = { files: [], sheet: 'npc', hp: 'hp', hpFormula: 'hp_dice', ac: 'armor_base', xp: 'xp', notes: 'notes' }
const RULES: EncounterRules = {
  source: 'test',
  level: 'level',
  xp: 'xp',
  bands: [{ id: 'low', name: 'Low' }, { id: 'moderate', name: 'Moderate' }, { id: 'high', name: 'High' }],
  budget: { 1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400] },
}
const goblin: CreatureEntry = { key: 'srd-2024_goblin', name: 'Goblin', source: 'srd-2024', cr: 0.25, xp: 50, data: { xp: 50, armor_base: 15, hp: { current: 10, max: 10 }, hp_dice: '3d6', notes: '' } }
const ogreT: CreatureTemplate = { id: 't1', name: 'Swamp Ogre', from: 'srd-2024_ogre', source: 'srd-2024', data: { xp: 450, armor_base: 11, hp: { current: 68, max: 68 } }, updatedAt: 0 }

describe('encounter rows', () => {
  it('resolves pack and game creature refs', () => {
    expect(resolveCreature('pack:srd-2024_goblin', [goblin], {})).toMatchObject({ name: 'Goblin', source: 'srd-2024', custom: false })
    expect(resolveCreature('game:t1', [goblin], { t1: ogreT })).toMatchObject({ name: 'Swamp Ogre', custom: true })
    expect(resolveCreature('pack:gone', [goblin], {})).toBeUndefined()
    expect(resolveCreature(undefined, [goblin], {})).toBeUndefined()
  })

  it('names tokens from the override, the creature, or a fallback', () => {
    expect(rowName(newRow(0, { overrides: { name: 'Snaga' } }), goblin)).toBe('Snaga')
    expect(rowName(newRow(0), goblin)).toBe('Goblin')
    expect(rowName(newRow(0))).toBe('Creature')
    expect(tokenNames('Goblin', 1)).toEqual(['Goblin'])
    expect(tokenNames('Goblin', 3)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3'])
  })

  it('gives each token its own sheet copy with the overrides written in', () => {
    const row = newRow(0, { overrides: { ac: 17, notes: 'Carries the key' } })
    const a = creatureSheetData(CONFIG, goblin.data, row)
    const b = creatureSheetData(CONFIG, goblin.data, row, 14)
    expect(a).toMatchObject({ armor_base: 17, hp: { current: 10, max: 10 }, notes: 'Carries the key' })
    expect(b.hp).toEqual({ current: 14, max: 14 })
    ;(a.hp as { current: number }).current = 1
    expect(goblin.data.hp).toEqual({ current: 10, max: 10 })
    expect(creatureSheetData(CONFIG, goblin.data, newRow(0, { overrides: { hp: 30 } }), 5).hp).toEqual({ current: 30, max: 30 })
    expect(averageHp(CONFIG, goblin.data)).toBe(10)
    expect(hpFormula(CONFIG, goblin.data)).toBe('3d6')
    expect(hpFormula(CONFIG, { hp_dice: '' })).toBeUndefined()
  })

  it('copies a compendium entry into an editable template', () => {
    const t = templateFrom({ ref: 'pack:srd-2024_goblin', name: 'Goblin', source: 'srd-2024', data: goblin.data, custom: false }, 5)
    expect(t).toMatchObject({ name: 'Goblin', from: 'srd-2024_goblin', source: 'srd-2024', updatedAt: 5 })
    expect(t.data).not.toBe(goblin.data)
    expect(t.data).toEqual(goblin.data)
  })
})

describe('difficulty', () => {
  it('clamps the budget table to its levels', () => {
    expect(budgetFor(RULES, 2)).toEqual([100, 150, 200])
    expect(budgetFor(RULES, 0)).toEqual([50, 75, 100])
    expect(budgetFor(RULES, 9)).toEqual([150, 225, 400])
  })

  it('adds the party budget, leaves friendlies out and shows the arithmetic', () => {
    const d = encounterDifficulty(RULES, { levels: [2, 2, 2, 2] }, [
      { name: 'Goblin', count: 4, xp: 50 },
      { name: 'Bugbear', count: 1, xp: 200 },
      { name: 'Guide', count: 1, xp: 25, friendly: true },
    ])
    expect(d.budgets.map((b) => b.xp)).toEqual([400, 600, 800])
    expect(d.total).toBe(400)
    expect(difficultyLabel(d, true)).toBe('Low')
    expect(d.friendlies).toBe(1)
    expect(difficultyArithmetic(d)).toBe('4 × Goblin (50) + 1 × Bugbear (200) = 400 XP')
  })

  it('reads Moderate, High and above the top band', () => {
    const party = { levels: [1, 1, 1, 1] }
    const at = (xp: number) => difficultyLabel(encounterDifficulty(RULES, party, [{ name: 'X', count: 1, xp }]), true)
    expect([at(200), at(201), at(300), at(301), at(400), at(401)]).toEqual(['Low', 'Moderate', 'Moderate', 'High', 'High', 'Above High'])
    expect(difficultyLabel(encounterDifficulty(RULES, { levels: [] }, [{ name: 'X', count: 1, xp: 50 }]), false)).toBe('No party')
    expect(difficultyLabel(encounterDifficulty(RULES, party, []), true)).toBe('Nothing hostile')
  })

  it('finds the party from player-owned sheets in the scene, or takes it by hand', () => {
    const tok = (id: string, scene: string, character: string, owner?: string) => ({ id, scene, character, owner }) as unknown as Token
    const ch = (id: string, level: number) => ({ id, name: id, data: { level } }) as unknown as Character
    const tokens = { a: tok('a', 's1', 'c1', 'p1'), b: tok('b', 's1', 'c2', 'p2'), c: tok('c', 's1', 'c3'), d: tok('d', 's2', 'c4', 'p3') } as unknown as Record<TokenId, Token>
    const characters = { c1: ch('c1', 3), c2: ch('c2', 5), c3: ch('c3', 9), c4: ch('c4', 1) } as Record<CharacterId, Character>
    expect(detectParty(RULES, tokens, characters, 's1')).toEqual({ size: 2, level: 4, from: 'sheets', levels: [3, 5] })
    expect(detectParty(RULES, tokens, characters, 'empty').levels).toEqual([3, 5, 1])
    expect(detectParty(RULES, tokens, characters, 's1', { size: 5, level: 2 })).toMatchObject({ size: 5, level: 2, from: 'manual', levels: [2, 2, 2, 2, 2] })
    expect(detectParty(RULES, {} as Record<TokenId, Token>, characters, 's1').from).toBe('none')
  })
})

describe('group initiative', () => {
  it('gives a group one score, replaces its old entries and keeps it together', () => {
    const t = (s: string) => s as TokenId
    const order = [{ token: t('pc1'), score: 15 }, { token: t('g1'), score: 3 }, { token: t('pc2'), score: 8 }]
    expect(mergeGroupInitiative(order, [{ tokens: [t('g1'), t('g2'), t('g3')], score: 12 }])).toEqual([
      { token: 'pc1', score: 15 }, { token: 'g1', score: 12 }, { token: 'g2', score: 12 }, { token: 'g3', score: 12 }, { token: 'pc2', score: 8 },
    ])
  })
})

describe('moving localStorage encounters into the game', () => {
  it('turns old rows into rows with a name override', () => {
    const old = [
      { id: 'e1', name: 'Ambush', rows: [{ id: 'r1', name: 'Rat', count: 3, color: '#fff', generateSheet: true }, { id: 'r2', name: '', count: 1, color: '#000', generateSheet: false }], placed: ['t1', 5] },
      { nope: true },
    ]
    const [e] = migrateLegacyEncounters(old, 100)
    expect(migrateLegacyEncounters(old)).toHaveLength(1)
    expect(e).toEqual({
      id: 'e1', name: 'Ambush', placed: ['t1'], createdAt: 100,
      rows: [{ id: 'r1', count: 3, color: '#fff', overrides: { name: 'Rat' }, generateSheet: true }, { id: 'r2', count: 1, color: '#000' }],
    })
    expect(migrateLegacyEncounters('garbage')).toEqual([])
  })

  it('lists encounters in creation order', () => {
    const e = (id: string, createdAt?: number) => ({ id, name: id, rows: [], placed: [], createdAt })
    expect(sortEncounters({ b: e('b', 2), a: e('a', 1), c: e('c') }).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
})
