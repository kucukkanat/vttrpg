import { describe, expect, it } from 'vitest'
import type { Cell, GridSpec } from '@/core/geometry'
import { cellDistance, cellToWorld } from './grid'
import { moveMeasure, pathCells } from './moveDistance'

const square: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0.75, y: 0, z: 0.75 } }
const hex: GridSpec = { type: 'hex', cellSize: 2, origin: { x: 0, y: 0, z: 0 } }
const none: GridSpec = { type: 'none', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
const at = (g: GridSpec, q: number, r: number) => { const w = cellToWorld(g, { q, r }); return { x: w.x, z: w.y } }

function contiguous(g: GridSpec, cells: Cell[]): boolean {
  return cells.every((c, i) => i === 0 || cellDistance(g, cells[i - 1]!, c) === 1)
}

describe('moveMeasure', () => {
  it('counts cells the way the ruler does, with metres', () => {
    const m = moveMeasure(square, at(square, 0, 0), at(square, 3, 4))
    expect(m.steps).toBe(4)
    expect(m.label).toBe('4 cells · 6 m')
  })
  it('uses the pack units', () => {
    expect(moveMeasure(square, at(square, 0, 0), at(square, 2, 0), 'dnd5e').label).toBe('2 cells · 10 ft / 3 m')
    expect(moveMeasure(hex, at(hex, 0, 0), at(hex, 1, 0), 'mausritter').label).toBe('1 hex · 2 m')
  })
})

describe('pathCells', () => {
  it('lists every cell from start to end on a square grid, one per step', () => {
    const cells = pathCells(square, at(square, 0, 0), at(square, 4, 2))
    expect(cells).toHaveLength(5)
    expect(cells[0]).toEqual({ q: 0, r: 0 })
    expect(cells[4]).toEqual({ q: 4, r: 2 })
    expect(contiguous(square, cells)).toBe(true)
  })
  it('runs straight along an axis and a diagonal', () => {
    expect(pathCells(square, at(square, 0, 0), at(square, 0, -3))).toEqual([{ q: 0, r: 0 }, { q: 0, r: -1 }, { q: 0, r: -2 }, { q: 0, r: -3 }])
    expect(pathCells(square, at(square, 0, 0), at(square, 2, 2))).toEqual([{ q: 0, r: 0 }, { q: 1, r: 1 }, { q: 2, r: 2 }])
  })
  it('walks neighbouring hexes on a hex grid', () => {
    const cells = pathCells(hex, at(hex, 0, 0), at(hex, 3, -1))
    expect(cells).toHaveLength(4)
    expect(cells[3]).toEqual({ q: 3, r: -1 })
    expect(contiguous(hex, cells)).toBe(true)
  })
  it('is the one cell when the token has not left it, and empty without a grid', () => {
    expect(pathCells(square, at(square, 1, 1), at(square, 1, 1))).toEqual([{ q: 1, r: 1 }])
    expect(pathCells(none, { x: 0, z: 0 }, { x: 3, z: 4 })).toEqual([])
  })
})
