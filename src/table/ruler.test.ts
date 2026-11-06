import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { formatQuantity, measure, rulerLabel, rulerSteps, snapRulerPoint } from './ruler'

const square: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0.75, y: 0, z: 0.75 } }
const hex: GridSpec = { type: 'hex', cellSize: 2, origin: { x: 0, y: 0, z: 0 } }
const none: GridSpec = { type: 'none', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }

describe('rulerSteps', () => {
  it('counts Chebyshev cells on a square grid, diagonals costing one', () => {
    const a = { x: 0.75, z: 0.75 }
    expect(rulerSteps(square, a, { x: 0.75 + 6 * 1.5, z: 0.75 })).toBe(6)
    expect(rulerSteps(square, a, { x: 0.75 + 3 * 1.5, z: 0.75 + 4 * 1.5 })).toBe(4)
    expect(rulerSteps(square, a, a)).toBe(0)
  })
  it('counts hex steps on a hex grid', () => {
    // Axial (3, 0): three hexes along q; (2, 2): four steps.
    expect(rulerSteps(hex, { x: 0, z: 0 }, { x: 6, z: 0 })).toBe(3)
    expect(rulerSteps(hex, { x: 0, z: 0 }, { x: 2 * (2 + 1), z: 2 * (Math.sqrt(3) / 2) * 2 })).toBe(4)
  })
  it('measures straight-line cell lengths to one decimal without a grid', () => {
    expect(rulerSteps(none, { x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5)
    expect(rulerSteps(none, { x: 0, z: 0 }, { x: 1, z: 1 })).toBe(1.4)
  })
  it('does not depend on where inside the cells the points fall', () => {
    expect(rulerSteps(square, { x: 0.2, z: 1.3 }, { x: 0.2 + 6 * 1.5 + 0.4, z: 1.3 - 0.9 })).toBe(6)
  })
})

describe('snapRulerPoint', () => {
  it('snaps to cell centres on square and hex grids and leaves points alone without a grid', () => {
    expect(snapRulerPoint(square, 1.6, 2.1)).toEqual({ x: 2.25, z: 2.25 })
    const h = snapRulerPoint(hex, 1.9, 0.1)
    expect(h.x).toBeCloseTo(2)
    expect(h.z).toBeCloseTo(0)
    expect(snapRulerPoint(none, 1.234, 5.678)).toEqual({ x: 1.234, z: 5.678 })
  })
})

describe('rulerLabel', () => {
  it('shows feet and metres for dnd5e', () => {
    expect(rulerLabel(6, square, 'dnd5e')).toBe('6 cells · 30 ft / 9 m')
    expect(rulerLabel(1, square, 'dnd5e')).toBe('1 cell · 5 ft / 1.5 m')
  })
  it('shows cells only for mausritter', () => {
    expect(rulerLabel(6, square, 'mausritter')).toBe('6 cells')
    expect(rulerLabel(1, square, 'mausritter')).toBe('1 cell')
  })
  it('falls back to cells and metres for other or unknown packs', () => {
    expect(rulerLabel(6, square, 'homebrew')).toBe('6 cells · 9 m')
    expect(rulerLabel(6, square, null)).toBe('6 cells · 9 m')
    expect(rulerLabel(0, square)).toBe('0 cells · 0 m')
  })
  it('counts hexes on a hex grid', () => {
    expect(rulerLabel(3, hex, 'dnd5e')).toBe('3 hexes · 15 ft / 6 m')
    expect(rulerLabel(1, hex, 'mausritter')).toBe('1 hex')
  })
  it('keeps one decimal for fractional lengths', () => {
    expect(rulerLabel(1.4, none, null)).toBe('1.4 cells · 1.4 m')
    expect(formatQuantity(2.5)).toBe('2.5')
    expect(formatQuantity(3.04)).toBe('3')
    expect(formatQuantity(7.5 * 1.5)).toBe('11.3')
  })
})

describe('measure', () => {
  it('snaps both ends and labels the distance', () => {
    const m = measure(square, { x: 0.6, z: 0.9 }, { x: 0.6 + 4 * 1.5, z: 0.9 }, 'dnd5e')
    expect(m.from).toEqual({ x: 0.75, z: 0.75 })
    expect(m.to).toEqual({ x: 6.75, z: 0.75 })
    expect(m.steps).toBe(4)
    expect(m.label).toBe('4 cells · 20 ft / 6 m')
  })
})
