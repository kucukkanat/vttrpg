import { describe, expect, it } from 'vitest'
import { dieLabel, dieShape, dieViews, outcomeText, pipCells, pipPoint, rollLabel, rollOutcome, rollSummary, shapePoints } from './diceFaces'

describe('pipCells', () => {
  it('lays out 1–6 like a real die', () => {
    expect(pipCells(1)).toEqual([4])
    expect(pipCells(2)).toEqual([2, 6])
    expect(pipCells(3)).toEqual([2, 4, 6])
    expect(pipCells(4)).toEqual([0, 2, 6, 8])
    expect(pipCells(5)).toEqual([0, 2, 4, 6, 8])
    expect(pipCells(6)).toEqual([0, 2, 3, 5, 6, 8])
  })
  it('has as many pips as the value, each a distinct cell', () => {
    for (let v = 1; v <= 6; v++) {
      const cells = pipCells(v)!
      expect(cells).toHaveLength(v)
      expect(new Set(cells).size).toBe(v)
      expect(cells.every((c) => c >= 0 && c <= 8)).toBe(true)
    }
  })
  it('has no layout outside 1–6', () => {
    expect(pipCells(0)).toBeNull()
    expect(pipCells(7)).toBeNull()
  })
  it('places cells on a 3×3 grid inside the face', () => {
    expect(pipPoint(0)).toEqual({ x: 9, y: 9 })
    expect(pipPoint(4)).toEqual({ x: 16, y: 16 })
    expect(pipPoint(8)).toEqual({ x: 23, y: 23 })
  })
})

describe('dieShape', () => {
  it('draws d6 as pips and the rest as polygons', () => {
    expect(dieShape(6, 3)).toBe('pips')
    expect(dieShape(4, 3)).toBe('triangle')
    expect(dieShape(8, 3)).toBe('diamond')
    expect(dieShape(10, 3)).toBe('kite')
    expect(dieShape(12, 3)).toBe('pentagon')
    expect(dieShape(20, 3)).toBe('hexagon')
    expect(dieShape(100, 42)).toBe('round')
    expect(dieShape(undefined, 3)).toBe('round')
  })
  it('gives every polygon shape points and none to the others', () => {
    for (const s of ['triangle', 'diamond', 'kite', 'pentagon', 'hexagon'] as const) expect(shapePoints(s)).toMatch(/\d/)
    expect(shapePoints('pips')).toBeNull()
    expect(shapePoints('round')).toBeNull()
  })
})

describe('dieViews', () => {
  it('marks dice dropped by keep-highest', () => {
    const v = dieViews('4d6kh3', [{ sides: 6, value: 2 }, { sides: 6, value: 5 }, { sides: 6, value: 1 }, { sides: 6, value: 4 }])
    expect(v.map((d) => d.kept)).toEqual([true, true, false, true])
  })
  it('marks dice dropped by keep-lowest (disadvantage)', () => {
    const v = dieViews('2d20kl1', [{ sides: 20, value: 17 }, { sides: 20, value: 3 }])
    expect(v.map((d) => d.kept)).toEqual([false, true])
  })
  it('flags natural max and natural 1', () => {
    const [a, b, c] = dieViews('3d20', [{ sides: 20, value: 20 }, { sides: 20, value: 1 }, { sides: 20, value: 11 }])
    expect([a.max, a.min]).toEqual([true, false])
    expect([b.max, b.min]).toEqual([false, true])
    expect([c.max, c.min]).toEqual([false, false])
  })
  it('does not flag dice without known sides', () => {
    const [d] = dieViews('1d20', [{ value: 20 }])
    expect(d.max).toBe(false)
    expect(d.min).toBe(false)
  })
})

describe('labels', () => {
  it('speaks one die', () => {
    expect(dieLabel({ value: 20, sides: 20, kept: true, max: true, min: false })).toBe('20 on d20, natural max')
    expect(dieLabel({ value: 1, sides: 20, kept: false, max: false, min: true })).toBe('1 on d20, natural 1, dropped')
    expect(dieLabel({ value: 4, kept: true, max: false, min: false })).toBe('4')
  })
  it('reads the pack outcome', () => {
    expect(rollOutcome(undefined)).toBeNull()
    expect(rollOutcome({ other: 1 })).toBeNull()
    expect(rollOutcome({ success: true })).toEqual({ success: true, critical: false })
    expect(outcomeText({ success: true, critical: false })).toBe('Success')
    expect(outcomeText({ success: false, critical: false })).toBe('Fail')
    expect(outcomeText({ success: true, critical: true })).toBe('Critical success')
    expect(outcomeText({ success: false, critical: true })).toBe('Critical fail')
  })
  it('skips a label that only repeats the formula', () => {
    expect(rollLabel('1d20+3', '1d20+3')).toBeNull()
    expect(rollLabel('  ', '1d20')).toBeNull()
    expect(rollLabel('Bramble: STR save', '1d20+3')).toBe('Bramble: STR save')
  })
  it('summarises the whole roll', () => {
    const roll = { formula: '1d20+3', dice: [{ sides: 20, value: 14 }], total: 17, outcome: { success: true, critical: false } }
    expect(rollSummary(roll, 'Bramble: STR save')).toBe('Bramble: STR save, 1d20+3, total 17. Dice: 14 on d20. Success.')
    expect(rollSummary({ formula: '2d6', dice: [{ sides: 6, value: 6 }, { sides: 6, value: 2 }], total: 8 }, '2d6')).toBe('2d6, total 8. Dice: 6 on d6, natural max; 2 on d6.')
  })
})
