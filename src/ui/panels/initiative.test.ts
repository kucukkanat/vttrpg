import { describe, expect, it } from 'vitest'
import type { Character, InitiativeState, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { createRulesEngine, loadPack, type LoadedPack } from '@/rules'
import { fileFetch, loadMausritter, mouse } from '@/rules/test-helpers'
import { rollFromSeed } from '@/dice/fair'
import {
  combatantName, combatants, concernsViewer, currentEntry, encounterSummary, groupKey, initiativeFormula, joinAbove, lateJoin, leaveGroup, moveEntry, nameStem,
  recentSheetInitiative, rollInitiative, seedFor, sheetInitiativeRoll, slotName, summaryHasNews, turnLabel, withScore, withSheetInitiative,
} from './initiative'

const me = 'me'.padEnd(64, '0') as PlayerPubkey
const other = 'other'.padEnd(64, '0') as PlayerPubkey
const scene = 'tavern' as SceneId
const t = (id: string, over: Partial<Token> = {}): Token => ({
  id: id as TokenId, scene, name: id, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [], ...over,
})
const byId = (...list: Token[]) => Object.fromEntries(list.map((x) => [x.id, x])) as Record<TokenId, Token>
const e = (id: string, score: number) => ({ token: id as TokenId, score })

describe('initiativeFormula', () => {
  it('finds the D&D 5e sheet roll and leaves Mausritter to a plain d20', async () => {
    const dnd: LoadedPack = await loadPack('packs/dnd5e/', fileFetch)
    expect(initiativeFormula(dnd)).toBe('d20 + initiative')
    expect(initiativeFormula(await loadMausritter())).toBeNull()
    expect(initiativeFormula(null)).toBeNull()
  })
})

describe('combatants', () => {
  it('lists visible tokens of the scene that have a sheet', () => {
    const tokens = byId(
      t('pip', { character: 'c1' as CharacterId }),
      t('mini'),
      t('ghost', { character: 'c2' as CharacterId, hidden: true }),
      t('away', { character: 'c3' as CharacterId, scene: 'cellar' as SceneId }),
    )
    expect(combatants(tokens, scene).map((x) => x.id)).toEqual(['pip'])
    expect(combatants(tokens, null)).toEqual([])
  })
})

describe('rollInitiative', () => {
  it('rolls each sheet through the pack formula and is reproducible from the seed', async () => {
    const dnd = createRulesEngine(await loadPack('packs/dnd5e/', fileFetch))
    const sheet: Character = { id: 'c1' as CharacterId, name: 'Pip', data: { dex: 16 } }
    const tokens = [t('pip', { character: sheet.id })]
    const chars = { [sheet.id]: sheet } as Record<CharacterId, Character>
    const a = await rollInitiative(tokens, chars, dnd, 'seed-1')
    const b = await rollInitiative(tokens, chars, dnd, 'seed-1')
    expect(a).toEqual(b)
    const expected = await dnd.roll('d20 + initiative', seedFor('seed-1', tokens[0].id), { character: sheet })
    expect(a[0].score).toBe(expected.total)
    // dex 16 is a +3 modifier, so the score sits in 4..23.
    expect(a[0].score).toBeGreaterThanOrEqual(4)
    expect(a[0].score).toBeLessThanOrEqual(23)
  })
  it('falls back to a d20 without a pack formula or a sheet', async () => {
    const maus = createRulesEngine(await loadMausritter())
    const sheet = mouse('c1', 'Pip', {})
    const tokens = [t('pip', { character: sheet.id }), t('mini')]
    const out = await rollInitiative(tokens, { [sheet.id]: sheet } as Record<CharacterId, Character>, maus, 'seed-2')
    const d20 = await rollFromSeed('d20', seedFor('seed-2', tokens[0].id))
    expect(out[0]).toEqual({ token: 'pip', score: d20.total })
    expect(out[1].score).toBeGreaterThanOrEqual(1)
    expect(out[1].score).toBeLessThanOrEqual(20)
    const noRules = await rollInitiative(tokens, {}, null, 'seed-2')
    expect(noRules[0].score).toBe(d20.total)
  })
})

describe('order edits', () => {
  it('moves an entry and clamps at the ends', () => {
    const order = [e('a', 3), e('b', 2), e('c', 1)]
    expect(moveEntry(order, 2, 0).map((x) => x.token)).toEqual(['c', 'a', 'b'])
    expect(moveEntry(order, 0, 1).map((x) => x.token)).toEqual(['b', 'a', 'c'])
    expect(moveEntry(order, 0, -1)).toBe(order)
    expect(moveEntry(order, 2, 9)).toBe(order)
    expect(moveEntry(order, 7, 0)).toBe(order)
  })
  it('re-sorts after a score edit, ties keeping their place', () => {
    const order = [e('a', 10), e('b', 8), e('c', 8)]
    expect(withScore(order, 'c' as TokenId, 12).map((x) => x.token)).toEqual(['c', 'a', 'b'])
    expect(withScore(order, 'a' as TokenId, 8).map((x) => x.token)).toEqual(['a', 'b', 'c'])
  })
})

describe('labels', () => {
  const tokens = byId(t('pip', { owner: me }), t('ghost', { hidden: true }))
  const state: InitiativeState = { active: true, round: 2, turn: 0, order: [e('pip', 14), e('ghost', 9)] }
  it('names the round and whose turn it is', () => {
    expect(turnLabel(state, tokens, false)).toBe("Round 2 · pip's turn")
    expect(turnLabel({ ...state, turn: 1 }, tokens, false)).toBe("Round 2 · Someone's turn")
    expect(turnLabel({ ...state, turn: 1 }, tokens, true)).toBe("Round 2 · ghost's turn")
    expect(turnLabel({ ...state, active: false }, tokens, true)).toBeNull()
    expect(turnLabel(null, tokens, true)).toBeNull()
    expect(turnLabel({ ...state, order: [] }, tokens, true)).toBeNull()
  })
  it('hides hidden names from players and marks missing tokens', () => {
    expect(combatantName(tokens['ghost' as TokenId], false)).toBe('Someone')
    expect(combatantName(tokens['ghost' as TokenId], true)).toBe('ghost')
    expect(combatantName(undefined, true)).toBe('Gone')
    expect(currentEntry(state)).toEqual(e('pip', 14))
    expect(currentEntry({ ...state, active: false })).toBeUndefined()
  })
  it('selects the token for its owner and the GM only', () => {
    const pip = tokens['pip' as TokenId]
    expect(concernsViewer(pip, me, false)).toBe(true)
    expect(concernsViewer(pip, other, false)).toBe(false)
    expect(concernsViewer(pip, other, true)).toBe(true)
    expect(concernsViewer(undefined, me, false)).toBe(false)
  })
})

describe('group initiative helpers', () => {
  const g = (id: string, score: number, group: string) => ({ token: id as TokenId, score, group })
  it('groups unowned copies of a creature by name stem', () => {
    expect(nameStem('Goblin 3')).toBe('Goblin')
    expect(nameStem('Goblin #12')).toBe('Goblin')
    expect(nameStem('7')).toBe('7')
    expect(groupKey({ name: 'Goblin 2' })).toBe('npc:goblin')
    expect(groupKey({ name: 'Pip', owner: me })).toBeNull()
  })
  it('rolls once per group and shares the score', async () => {
    const list = [t('Goblin 1'), t('Pip', { owner: me }), t('Goblin 2'), t('Rat')]
    const order = await rollInitiative(list, {}, null, 'seed', { group: true })
    expect(order[0]).toMatchObject({ group: 'npc:goblin' })
    expect(order[2]).toMatchObject({ group: 'npc:goblin', score: order[0]!.score })
    expect(order[1]!.group).toBeUndefined()
    // A lone rat is no group.
    expect(order[3]!.group).toBeUndefined()
    const known = await rollInitiative([t('Pip', { owner: me })], {}, null, 'seed', { known: new Map([['Pip' as TokenId, 19]]) })
    expect(known).toEqual([e('Pip', 19)])
  })
  it('a late joiner slots in by score or joins its group', () => {
    const order = [e('pip', 18), g('Goblin 1', 12, 'npc:goblin'), g('Goblin 2', 12, 'npc:goblin'), e('rat', 4)]
    expect(lateJoin(order, t('bat'), 10).map((x) => x.token)).toEqual(['pip', 'Goblin 1', 'Goblin 2', 'bat', 'rat'])
    expect(lateJoin(order, t('Goblin 3'), 1)[3]).toEqual(g('Goblin 3', 12, 'npc:goblin'))
    expect(lateJoin(order, t('pip'), 1)).toBe(order)
  })
  it('joins the slot above and leaves it again', () => {
    const order = [e('a', 18), e('b', 12), e('c', 4)]
    const joined = joinAbove(order, 2)
    expect(joined).toEqual([e('a', 18), g('b', 12, 'g:b'), g('c', 12, 'g:b')])
    expect(joinAbove(joined, 2)).toBe(joined)
    expect(joinAbove(order, 0)).toBe(order)
    expect(leaveGroup(joined, 'b' as TokenId)).toEqual([e('a', 18), e('c', 12), e('b', 12)])
    expect(leaveGroup(order, 'a' as TokenId)).toBe(order)
  })
  it('scores a whole group at once and names its slot', () => {
    const order = [e('pip', 18), g('g1', 12, 'x'), g('g2', 12, 'x')]
    expect(withScore(order, 'g2' as TokenId, 20)).toEqual([g('g1', 20, 'x'), g('g2', 20, 'x'), e('pip', 18)])
    const tokens = byId(t('g1', { name: 'Goblin 1' }), t('g2', { name: 'Goblin 2', hidden: true }))
    expect(slotName(order.slice(1), tokens, true)).toBe('Goblin ×2')
    expect(slotName(order.slice(1), tokens, false)).toBe('Goblin 1')
    const s: InitiativeState = { active: true, round: 3, turn: 1, order }
    expect(turnLabel(s, tokens, true)).toBe("Round 3 · Goblin ×2's turn")
  })
})

describe('initiative from sheets', () => {
  const pip = t('pip', { character: 'c1' as CharacterId, owner: me })
  const pip2 = t('pip2', { character: 'c1' as CharacterId, scene: 'elsewhere' as SceneId })
  const rat = t('rat', { character: 'c2' as CharacterId })
  const tokens = byId(pip, pip2, rat)
  const roll = (character: string, total: number, at = 100, text = 'Pip · Initiative') =>
    ({ id: `${at}`, author: me, at, kind: 'roll' as const, text, character: character as CharacterId, roll: { formula: 'd20', seed: 's', dice: [], total } })
  it('recognises an initiative roll made from a sheet', () => {
    expect(sheetInitiativeRoll(roll('c1', 15))).toEqual({ character: 'c1', total: 15 })
    expect(sheetInitiativeRoll(roll('c1', 15, 100, 'Pip · Stealth'))).toBeNull()
    expect(sheetInitiativeRoll({ ...roll('c1', 15), character: undefined })).toBeNull()
  })
  it('collects recent rolls by token in the scene', () => {
    const recent = recentSheetInitiative([roll('c1', 3, 10), roll('c1', 15, 100), roll('c2', 9, -1_000_000)], tokens, scene, 200)
    expect([...recent]).toEqual([['pip', 15]])
  })
  it('updates a listed combatant or adds a late joiner', () => {
    const s: InitiativeState = { active: true, round: 1, turn: 0, order: [e('rat', 10)] }
    expect(withSheetInitiative(s, tokens, scene, 'c1' as CharacterId, 14)).toEqual({ order: [e('pip', 14), e('rat', 10)], joined: 'pip', updated: [] })
    const listed: InitiativeState = { ...s, order: [e('rat', 10), e('pip', 3)] }
    expect(withSheetInitiative(listed, tokens, scene, 'c1' as CharacterId, 12)).toEqual({ order: [e('pip', 12), e('rat', 10)], updated: ['pip'] })
    expect(withSheetInitiative(listed, tokens, scene, 'c1' as CharacterId, 3)).toBeNull()
    expect(withSheetInitiative({ ...s, active: false }, tokens, scene, 'c1' as CharacterId, 3)).toBeNull()
    expect(withSheetInitiative(s, tokens, scene, 'zz' as CharacterId, 3)).toBeNull()
  })
})

describe('encounterSummary', () => {
  const tokens = byId(t('pip', { name: 'Pip' }), t('rat', { name: 'Rat', hidden: true }))
  const s: InitiativeState = {
    active: true, round: 3, turn: 0, order: [e('pip', 10), e('rat', 5)],
    log: [
      { source: 'pip' as TokenId, target: 'rat' as TokenId, resource: 'hp', delta: -4, round: 1 },
      { source: 'rat' as TokenId, target: 'pip' as TokenId, resource: 'hp', delta: -2, round: 1 },
      { source: 'pip' as TokenId, target: 'pip' as TokenId, resource: 'hp', delta: 1, round: 2 },
      { source: 'pip' as TokenId, target: 'pip' as TokenId, resource: 'slots', delta: -1, round: 2 },
      { source: 'pip' as TokenId, target: 'rat' as TokenId, resource: 'hp', delta: -3, ko: true, round: 3 },
      { target: 'rat' as TokenId, resource: 'hp', delta: 2, round: 3 },
    ],
  }
  it('adds up damage, healing and knockouts on the primary resource', () => {
    const out = encounterSummary(s, tokens, 'hp', (id) => id === 'rat')!
    expect(out.rounds).toBe(3)
    expect(out.rows).toEqual([
      { token: 'pip', name: 'Pip', dealt: 7, taken: 2, healed: 1, kos: 1 },
      { token: 'rat', name: 'Rat', hidden: true, dealt: 2, taken: 7, healed: 2, kos: 0, down: true },
    ])
    expect(summaryHasNews(out)).toBe(true)
  })
  it('is null between encounters and quiet without a log', () => {
    expect(encounterSummary({ ...s, active: false }, tokens)).toBeNull()
    expect(summaryHasNews(encounterSummary({ ...s, log: undefined }, tokens))).toBe(false)
  })
})
