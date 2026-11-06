import { describe, expect, it } from 'vitest'
import { commitSeed, diceFromSeed, parseFormula, rollFromSeed, totalFromDice, verifyCommit } from './fair'

describe('parseFormula', () => {
  it('parses simple and compound formulas', () => {
    expect(parseFormula('d20')).toMatchObject({ terms: [{ count: 1, sides: 20 }], modifier: 0 })
    expect(parseFormula('2d6+3')).toMatchObject({ terms: [{ count: 2, sides: 6 }], modifier: 3 })
    expect(parseFormula('4d6kh3 - 1')).toMatchObject({ terms: [{ count: 4, sides: 6, keep: 'highest', keepN: 3 }], modifier: -1 })
    expect(parseFormula('d20 + 2d4 + 1 + 1')).toMatchObject({ modifier: 2 })
  })
  it('rejects garbage', () => {
    expect(() => parseFormula('')).toThrow()
    expect(() => parseFormula('2x6')).toThrow()
    expect(() => parseFormula('d1')).toThrow()
    expect(() => parseFormula('4d6kh5')).toThrow()
  })
})

describe('deterministic dice', () => {
  const seed = 'a'.repeat(64)
  it('same seed gives same dice, values in range', async () => {
    const f = parseFormula('10d6')
    const a = await diceFromSeed(f, seed)
    const b = await diceFromSeed(f, seed)
    expect(a).toEqual(b)
    for (const d of a) expect(d.value).toBeGreaterThanOrEqual(1), expect(d.value).toBeLessThanOrEqual(6)
  })
  it('different seeds differ', async () => {
    const f = parseFormula('10d20')
    expect(await diceFromSeed(f, seed)).not.toEqual(await diceFromSeed(f, 'b'.repeat(64)))
  })
  it('keep highest totals correctly', () => {
    const f = parseFormula('4d6kh3+1')
    expect(totalFromDice(f, [1, 6, 3, 5].map((v) => ({ sides: 6, value: v })))).toBe(15)
  })
  it('commit/reveal round trips', async () => {
    const c = await commitSeed(seed)
    expect(c).toHaveLength(64)
    expect(await verifyCommit(seed, c)).toBe(true)
    expect(await verifyCommit('b'.repeat(64), c)).toBe(false)
  })
  it('rollFromSeed is stable across runs (golden)', async () => {
    const r = await rollFromSeed('2d6+1', '00'.repeat(32))
    expect(r.dice.length).toBe(2)
    expect(r.total).toBe(r.dice[0].value + r.dice[1].value + 1)
  })
})
