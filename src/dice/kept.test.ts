import { describe, expect, it } from 'vitest'
import { hasDropped, keptMask } from './kept'
import { parseFormula, totalFromDice } from './fair'

const d = (...values: number[]) => values.map((value) => ({ sides: 6, value }))

describe('keptMask', () => {
  it('keeps every die without a keep clause', () => {
    expect(keptMask('2d6+1', d(3, 5))).toEqual([true, true])
    expect(hasDropped('d20', d(17))).toBe(false)
  })
  it('drops the lowest dice for kh', () => {
    expect(keptMask('4d6kh3', d(2, 6, 1, 4))).toEqual([true, true, false, true])
  })
  it('drops the highest dice for kl', () => {
    expect(keptMask('2d20kl1', d(15, 3))).toEqual([false, true])
  })
  it('drops the later die on ties and agrees with the total', () => {
    const dice = d(4, 4, 4, 2)
    const mask = keptMask('4d6kh2', dice)
    expect(mask).toEqual([true, true, false, false])
    const kept = dice.filter((_, i) => mask[i]).reduce((a, x) => a + x.value, 0)
    expect(kept).toBe(totalFromDice(parseFormula('4d6kh2'), dice))
  })
  it('handles several terms in formula order', () => {
    expect(keptMask('d20 + 2d6kh1', d(11, 2, 5))).toEqual([true, false, true])
  })
  it('accepts a parsed formula', () => {
    expect(keptMask(parseFormula('3d6kl2'), d(6, 1, 3))).toEqual([false, true, true])
  })
  it('keeps everything when the formula does not parse or the dice do not match', () => {
    expect(keptMask('nonsense', d(1, 2))).toEqual([true, true])
    expect(keptMask('4d6kh3', d(1, 2))).toEqual([true, true])
  })
})
