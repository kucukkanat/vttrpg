import { describe, expect, it } from 'vitest'
import type { Character, InitiativeState, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { createRulesEngine, loadPack, type LoadedPack } from '@/rules'
import { fileFetch, loadMausritter, mouse } from '@/rules/test-helpers'
import { rollFromSeed } from '@/dice/fair'
import {
  combatantName, combatants, concernsViewer, currentEntry, initiativeFormula, moveEntry, rollInitiative, seedFor, turnLabel, withScore,
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
