import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { cellCentre, cellKey, cellOf, freeCellsNear, spiralCells } from './placement'

const square: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0.75, y: 0, z: 0.75 } }
const hex: GridSpec = { type: 'hex', cellSize: 2, origin: { x: 0, y: 0, z: 0 } }

describe('cell math', () => {
  it('round-trips square cells through world space', () => {
    expect(cellOf(square, { x: 3.75, z: -0.75 })).toEqual({ q: 2, r: -1 })
    expect(cellCentre(square, { q: 2, r: -1 }, 0.2)).toEqual({ x: 3.75, y: 0.2, z: -0.75 })
    expect(cellOf(square, { x: 1.49, z: 1.49 })).toEqual({ q: 0, r: 0 })
    expect(cellOf(square, { x: 1.51, z: 0.2 })).toEqual({ q: 1, r: 0 })
  })
  it('round-trips hex cells through world space', () => {
    for (const c of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -1, r: 4 }]) {
      const w = cellCentre(hex, c, 0)
      expect(cellOf(hex, w)).toEqual(c)
    }
  })
  it('never produces -0 in cells', () => {
    expect(Object.is(cellOf(square, { x: 0.74, z: 0.76 }).q, -0)).toBe(false)
  })
})

describe('spiral', () => {
  it('starts at the centre and visits each ring completely before the next', () => {
    const cells = [...take(spiralCells({ q: 0, r: 0 }), 25)]
    expect(cells[0]).toEqual({ q: 0, r: 0 })
    const ring = (c: { q: number; r: number }) => Math.max(Math.abs(c.q), Math.abs(c.r))
    expect(cells.slice(1, 9).every((c) => ring(c) === 1)).toBe(true)
    expect(cells.slice(9, 25).every((c) => ring(c) === 2)).toBe(true)
    expect(new Set(cells.map(cellKey)).size).toBe(25)
  })
  it('orders a ring by distance so orthogonal neighbours come before diagonals', () => {
    const ring1 = [...take(spiralCells({ q: 5, r: 5 }), 9)].slice(1)
    const d2 = (c: { q: number; r: number }) => (c.q - 5) ** 2 + (c.r - 5) ** 2
    expect(ring1.slice(0, 4).every((c) => d2(c) === 1)).toBe(true)
    expect(ring1.slice(4).every((c) => d2(c) === 2)).toBe(true)
  })
  it('is bounded by maxRing', () => {
    expect([...spiralCells({ q: 0, r: 0 }, 1)]).toHaveLength(9)
  })
})

describe('freeCellsNear', () => {
  it('returns the centre cell first when it is free', () => {
    const spots = freeCellsNear(square, { x: 0.8, y: 0, z: 0.7 }, [], 1)
    expect(spots).toEqual([{ x: 0.75, y: 0, z: 0.75 }])
  })
  it('skips cells that already hold a token', () => {
    const occupied = [{ x: 0.75, z: 0.75 }, { x: 2.25, z: 0.75 }, { x: -0.75, z: 0.75 }, { x: 0.75, z: 2.25 }, { x: 0.75, z: -0.75 }]
    const spots = freeCellsNear(square, { x: 0.75, y: 0, z: 0.75 }, occupied, 2)
    const taken = new Set(occupied.map((p) => cellKey(cellOf(square, p))))
    expect(spots).toHaveLength(2)
    for (const s of spots) {
      expect(taken.has(cellKey(cellOf(square, s)))).toBe(false)
      // Only the orthogonal ring-1 cells were taken, so the diagonals come next.
      expect(Math.max(Math.abs(s.x - 0.75), Math.abs(s.z - 0.75))).toBeCloseTo(1.5)
    }
  })
  it('treats an occupant anywhere inside a cell as occupying that cell', () => {
    const spots = freeCellsNear(square, { x: 0.75, y: 0, z: 0.75 }, [{ x: 1.3, z: 0.2 }], 1)
    expect(spots[0]).not.toEqual({ x: 0.75, y: 0, z: 0.75 })
  })
  it('never returns the same cell twice and keeps the requested count', () => {
    const spots = freeCellsNear(square, { x: 0, y: 0, z: 0 }, [], 12)
    expect(spots).toHaveLength(12)
    expect(new Set(spots.map((s) => cellKey(cellOf(square, s)))).size).toBe(12)
  })
  it('places on the floor height of the point', () => {
    expect(freeCellsNear(square, { x: 0, y: 1.25, z: 0 }, [], 3).every((s) => s.y === 1.25)).toBe(true)
  })
  it('returns nothing for a non-positive count', () => {
    expect(freeCellsNear(square, { x: 0, y: 0, z: 0 }, [], 0)).toEqual([])
  })
  it('clusters hex placements on hex centres', () => {
    const spots = freeCellsNear(hex, { x: 0.1, y: 0, z: 0.1 }, [{ x: 0, z: 0 }], 3)
    expect(spots).toHaveLength(3)
    for (const s of spots) {
      const back = cellCentre(hex, cellOf(hex, s), 0)
      expect(back.x).toBeCloseTo(s.x)
      expect(back.z).toBeCloseTo(s.z)
      expect(cellKey(cellOf(hex, s))).not.toBe('0,0')
    }
  })
})

function* take<T>(it: Iterable<T>, n: number): Generator<T> {
  let i = 0
  for (const x of it) { if (i++ >= n) return; yield x }
}
