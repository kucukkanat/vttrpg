import { describe, expect, it } from 'vitest'
import type { InitiativeEntry, InitiativeState } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { combatEntries, currentSlot, inCurrentSlot, nextTurn, sheetDeltas, slotRange, sortInitiative, withOrder, withoutToken } from './initiative'

const t = (id: string) => id as TokenId
const e = (id: string, score: number, group?: string): InitiativeEntry => (group ? { token: t(id), score, group } : { token: t(id), score })
const state = (order: InitiativeEntry[], turn = 0, round = 1): InitiativeState => ({ active: true, round, turn, order })

describe('group initiative', () => {
  const order = [e('pip', 18), e('g1', 12, 'gob'), e('g2', 12, 'gob'), e('g3', 12, 'gob'), e('rat', 4)]
  it('finds the slot of an entry', () => {
    expect(slotRange(order, 0)).toEqual([0, 0])
    expect(slotRange(order, 2)).toEqual([1, 3])
    expect(currentSlot(state(order, 1)).map((x) => x.token)).toEqual(['g1', 'g2', 'g3'])
    expect(inCurrentSlot(state(order, 1), 'g3')).toBe(true)
    expect(inCurrentSlot(state(order, 1), 'rat')).toBe(false)
    expect(currentSlot(null)).toEqual([])
  })
  it('a group takes one turn', () => {
    let s = state(order)
    s = nextTurn(s)
    expect(s.turn).toBe(1)
    s = nextTurn(s)
    expect(s).toMatchObject({ turn: 4, round: 1 })
    s = nextTurn(s)
    expect(s).toMatchObject({ turn: 0, round: 2 })
  })
  it('sorting keeps a group together even on a tie with an outsider', () => {
    const sorted = sortInitiative([e('g1', 12, 'gob'), e('bob', 12), e('pip', 20), e('g2', 12, 'gob')])
    expect(sorted.map((x) => x.token)).toEqual(['pip', 'g1', 'g2', 'bob'])
  })
  it('the turn stays at the start of the slot when the order changes', () => {
    const s = state(order, 1)
    expect(withOrder(s, order).turn).toBe(1)
    // The leader leaves: the next member takes the slot.
    expect(withoutToken(s, t('g1'))).toMatchObject({ turn: 1, order: [e('pip', 18), e('g2', 12, 'gob'), e('g3', 12, 'gob'), e('rat', 4)] })
    // A member mid-group leaves: nothing moves.
    expect(withoutToken(s, t('g2')).turn).toBe(1)
    // Pointing into the middle of a group snaps back to its start.
    expect(withOrder(state(order, 0), order.slice(1)).turn).toBe(0)
  })
  it('removing a combatant drops its declared action', () => {
    const s = { ...state(order), declared: { g1: { token: t('g1'), label: 'Slash', targets: [t('pip')], at: 1 } } }
    expect(withoutToken(s, t('g1')).declared).toEqual({})
  })
})

describe('combat log', () => {
  const s = state([e('pip', 10), e('rat', 5)])
  it('logs changes to combatants with the source and knockouts', () => {
    const out = combatEntries(s, [{ token: t('rat'), delta: -3, resource: 'hp' }, { token: t('ghost'), delta: -1, resource: 'hp' }], () => 2, t('pip'))
    expect(out).toEqual([{ source: 'pip', target: 'rat', resource: 'hp', delta: -3, ko: true, round: 1 }])
  })
  it('logs nothing outside combat and drops sources that are not fighting', () => {
    expect(combatEntries({ ...s, active: false }, [{ token: t('rat'), delta: -1, resource: 'hp' }], () => 5)).toEqual([])
    expect(combatEntries(s, [{ token: t('rat'), delta: -1, resource: 'hp' }], () => 5, t('bystander'))).toEqual([{ target: 'rat', resource: 'hp', delta: -1, round: 1 }])
  })
  it('diffs resource-shaped sheet keys', () => {
    expect(sheetDeltas({ hp: { current: 5, max: 6 }, name: 'x', wil: 3 }, { hp: { current: 2, max: 6 }, name: 'y', wil: 3 }, t('pip'))).toEqual([{ token: 'pip', delta: -3, resource: 'hp' }])
  })
})
