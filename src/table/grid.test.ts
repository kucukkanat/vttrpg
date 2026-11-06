import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import {
  axialRound, cellDistance, cellKey, cellsInBounds, cellsWithinRadius, cellToWorld, hexCorners, hexRadius,
  parseCellKey, snapToCell, worldToCell,
} from './grid'

const square: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0.75, y: 0, z: 0.75 } }
const hex: GridSpec = { type: 'hex', cellSize: 2, origin: { x: 0, y: 0, z: 0 } }

describe('cell keys', () => {
  it('round-trips', () => {
    expect(cellKey({ q: -3, r: 7 })).toBe('-3,7')
    expect(parseCellKey('-3,7')).toEqual({ q: -3, r: 7 })
    expect(parseCellKey('x,1')).toBeNull()
    expect(parseCellKey('1.5,1')).toBeNull()
  })
})

describe('square grid', () => {
  it('maps cell centres to world and back', () => {
    expect(cellToWorld(square, { q: 0, r: 0 })).toEqual({ x: 0.75, y: 0.75 })
    expect(cellToWorld(square, { q: 2, r: -1 })).toEqual({ x: 3.75, y: -0.75 })
    expect(worldToCell(square, 3.75, -0.75)).toEqual({ q: 2, r: -1 })
  })
  it('assigns points anywhere inside a cell to that cell', () => {
    expect(worldToCell(square, 0.01, 0.01)).toEqual({ q: 0, r: 0 })
    expect(worldToCell(square, 1.49, 1.49)).toEqual({ q: 0, r: 0 })
    expect(worldToCell(square, 1.51, 0.2)).toEqual({ q: 1, r: 0 })
  })
  it('snaps to the cell centre', () => {
    const s = snapToCell(square, 1.4, 2.9)
    expect(s.cell).toEqual({ q: 0, r: 1 })
    expect(s.x).toBeCloseTo(0.75)
    expect(s.z).toBeCloseTo(2.25)
  })
  it('uses Chebyshev distance', () => {
    expect(cellDistance(square, { q: 0, r: 0 }, { q: 3, r: -2 })).toBe(3)
  })
  it('collects cells within a radius', () => {
    const cells = cellsWithinRadius(square, 0.75, 0.75, 1)
    const keys = cells.map(cellKey).sort()
    // Euclidean radius 1 cell: the 4 orthogonal neighbours plus the centre.
    expect(keys).toEqual(['-1,0', '0,-1', '0,0', '0,1', '1,0'])
    expect(cellsWithinRadius(square, 0.75, 0.75, 0)).toEqual([{ q: 0, r: 0 }])
  })
})

describe('hex grid', () => {
  it('has the expected spacing', () => {
    expect(hexRadius(hex.cellSize)).toBeCloseTo(2 / Math.sqrt(3))
    expect(cellToWorld(hex, { q: 1, r: 0 })).toEqual({ x: 2, y: 0 })
    const r1 = cellToWorld(hex, { q: 0, r: 1 })
    expect(r1.x).toBeCloseTo(1)
    expect(r1.y).toBeCloseTo(Math.sqrt(3))
    // neighbours are all exactly cellSize apart
    const c0 = cellToWorld(hex, { q: 0, r: 0 })
    for (const n of [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }]) {
      const w = cellToWorld(hex, n)
      expect(Math.hypot(w.x - c0.x, w.y - c0.y)).toBeCloseTo(2)
    }
  })
  it('round-trips every cell centre', () => {
    for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
      const w = cellToWorld(hex, { q, r })
      expect(worldToCell(hex, w.x, w.y)).toEqual({ q, r })
    }
  })
  it('rounds fractional axial coordinates to the nearest hex', () => {
    expect(axialRound(0.3, 0.2)).toEqual({ q: 0, r: 0 })
    expect(axialRound(0.4, 0.3)).toEqual({ q: 1, r: 0 }) // (1,0) is the nearer centre
    expect(axialRound(0.9, 0.1)).toEqual({ q: 1, r: 0 })
    // a point near a corner picks a valid hex, and nearby points stay inside their hex radius
    const w = cellToWorld(hex, { q: 2, r: -1 })
    const R = hexRadius(hex.cellSize)
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const x = w.x + Math.cos(a) * R * 0.8, z = w.y + Math.sin(a) * R * 0.8
      expect(worldToCell(hex, x, z)).toEqual({ q: 2, r: -1 })
    }
  })
  it('uses hex distance', () => {
    expect(cellDistance(hex, { q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2)
    expect(cellDistance(hex, { q: 0, r: 0 }, { q: 1, r: 1 })).toBe(2)
    expect(cellDistance(hex, { q: 0, r: 0 }, { q: -1, r: 1 })).toBe(1)
  })
  it('collects the six neighbours within radius 1', () => {
    const keys = cellsWithinRadius(hex, 0, 0, 1).map(cellKey).sort()
    expect(keys).toEqual(['-1,0', '-1,1', '0,-1', '0,0', '0,1', '1,-1', '1,0'])
  })
  it('draws corners at the circumradius', () => {
    const pts = hexCorners(hex, { q: 0, r: 0 })
    expect(pts).toHaveLength(6)
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(hexRadius(2))
    // pointy-top: a corner straight down the +z axis
    expect(pts.some((p) => Math.abs(p.x) < 1e-9 && p.y > 0)).toBe(true)
  })
})

describe('cellsInBounds', () => {
  it('covers the bounds with a margin', () => {
    const cells = cellsInBounds(square, { minX: 0, minZ: 0, maxX: 3, maxZ: 3 })
    const keys = new Set(cells.map(cellKey))
    expect(keys.has('0,0')).toBe(true)
    expect(keys.has('1,1')).toBe(true)
    expect(keys.has('-1,-1')).toBe(true) // margin
    expect(keys.has('5,5')).toBe(false)
  })
})
