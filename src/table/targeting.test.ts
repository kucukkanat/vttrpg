import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { cellKey } from './grid'
import {
  cellsInShape, clampToRange, directionTo, pointInShape, resolveShape, shapeOutline, tokenAt, tokensInRange, tokensInShape,
} from './targeting'

const grid: GridSpec = { type: 'square', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
const hex: GridSpec = { type: 'hex', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }

const src = { x: 0, y: 0 }
const tokens = [
  { id: 'src', x: 0, z: 0 },
  { id: 'a', x: 1, z: 0 },
  { id: 'b', x: 3, z: 0 },
  { id: 'c', x: 0, z: 4 },
  { id: 'd', x: 7, z: 0 },
  { id: 'e', x: 3, z: 3 },
  { id: 'f', x: -2, z: 0 },
]

describe('clampToRange / directionTo', () => {
  it('leaves points within range alone and pulls far points onto the circle', () => {
    expect(clampToRange(src, { x: 2, y: 0 }, 3)).toEqual({ x: 2, y: 0 })
    const c = clampToRange(src, { x: 10, y: 0 }, 3)
    expect(c.x).toBeCloseTo(3)
    expect(c.y).toBeCloseTo(0)
    const d = clampToRange(src, { x: 3, y: 4 }, 2.5)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(2.5)
  })
  it('falls back to the facing when the pointer sits on the source', () => {
    expect(directionTo(src, { x: 0, y: 0 }, 1.2)).toBe(1.2)
    expect(directionTo(src, { x: 0, y: 2 })).toBeCloseTo(Math.PI / 2)
  })
})

describe('self', () => {
  it('targets only the source', () => {
    const shape = resolveShape(grid, { kind: 'self' }, src, { x: 5, y: 5 })
    expect(tokensInShape(shape, tokens, 'src')).toEqual(['src'])
    expect(tokensInShape(shape, tokens)).toEqual([])
    expect(tokensInRange(grid, { kind: 'self' }, src, tokens, 'src')).toEqual(['src'])
  })
})

describe('single', () => {
  it('reaches every token within range, including the source', () => {
    const shape = resolveShape(grid, { kind: 'single', range: 3 }, src, { x: 9, y: 9 })
    expect(tokensInShape(shape, tokens, 'src')).toEqual(['src', 'a', 'b', 'f'])
    expect(tokensInRange(grid, { kind: 'single', range: 3 }, src, tokens, 'src')).toEqual(['src', 'a', 'b', 'f'])
  })
  it('picks the token under the pointer within half a cell', () => {
    expect(tokenAt({ x: 3.3, y: 0.2 }, tokens, 1)).toBe('b')
    expect(tokenAt({ x: 3.8, y: 0 }, tokens, 1)).toBeNull()
    expect(tokenAt({ x: 1.2, y: 0 }, [{ id: 'big', x: 2, z: 0, scale: 2 }], 1)).toBe('big')
  })
  it('lists the cells in range', () => {
    const shape = resolveShape(grid, { kind: 'single', range: 1 }, src, src)
    const keys = cellsInShape(grid, shape).map(cellKey).sort()
    expect(keys).toEqual(['-1,0', '0,-1', '0,0', '0,1', '1,0'])
  })
})

describe('radius', () => {
  it('centres the disc on the pointer and includes tokens on the boundary', () => {
    const shape = resolveShape(grid, { kind: 'radius', range: 6, radius: 2 }, src, { x: 2, y: 1 })
    expect(shape.kind).toBe('radius')
    expect(tokensInShape(shape, tokens, 'src').sort()).toEqual(['a', 'b'])
  })
  it('clamps the centre to the range', () => {
    const shape = resolveShape(grid, { kind: 'radius', range: 4, radius: 1 }, src, { x: 20, y: 0 })
    if (shape.kind !== 'radius') throw new Error('expected radius')
    expect(shape.center.x).toBeCloseTo(4)
    expect(tokensInShape(shape, tokens, 'src')).toEqual(['b'])
  })
  it('counts the caster when the disc covers them', () => {
    const shape = resolveShape(grid, { kind: 'radius', range: 6, radius: 2 }, src, { x: 0.5, y: 0 })
    expect(tokensInShape(shape, tokens, 'src')).toContain('src')
  })
  it('dims tokens beyond range + radius', () => {
    const ids = tokensInRange(grid, { kind: 'radius', range: 3, radius: 1 }, src, tokens, 'src')
    expect(ids).not.toContain('d')
    expect(ids).toContain('c')
  })
  it('selects the cells whose centres fall in the disc', () => {
    const shape = resolveShape(grid, { kind: 'radius', range: 6, radius: 1 }, src, { x: 2, y: 2 })
    const keys = cellsInShape(grid, shape).map(cellKey).sort()
    expect(keys).toEqual(['1,2', '2,1', '2,2', '2,3', '3,2'])
  })
  it('works on hex grids', () => {
    const shape = resolveShape(hex, { kind: 'radius', range: 6, radius: 1 }, src, { x: 0, y: 0 })
    expect(cellsInShape(hex, shape)).toHaveLength(7)
  })
})

describe('cone', () => {
  it('hits tokens inside the wedge and never the caster', () => {
    const shape = resolveShape(grid, { kind: 'cone', range: 5, angle: 90 }, src, { x: 5, y: 0 })
    expect(tokensInShape(shape, tokens, 'src').sort()).toEqual(['a', 'b', 'e'])
    expect(pointInShape(shape, { x: 0, y: 0 })).toBe(false)
  })
  it('respects the opening angle and the length', () => {
    const narrow = resolveShape(grid, { kind: 'cone', range: 5, angle: 30 }, src, { x: 5, y: 0 })
    expect(tokensInShape(narrow, tokens, 'src').sort()).toEqual(['a', 'b'])
    expect(pointInShape(narrow, { x: 5.5, y: 0 })).toBe(false)
    expect(pointInShape(narrow, { x: 4.9, y: 0 })).toBe(true)
  })
  it('wraps angles around -PI / PI', () => {
    const shape = resolveShape(grid, { kind: 'cone', range: 5, angle: 60 }, src, { x: -5, y: 0 })
    expect(pointInShape(shape, { x: -3, y: 0.5 })).toBe(true)
    expect(pointInShape(shape, { x: -3, y: -0.5 })).toBe(true)
    expect(tokensInShape(shape, tokens, 'src')).toEqual(['f'])
  })
  it('uses the facing when the pointer is on the source', () => {
    const shape = resolveShape(grid, { kind: 'cone', range: 5, angle: 60 }, src, src, Math.PI / 2)
    expect(tokensInShape(shape, tokens, 'src')).toEqual(['c'])
  })
  it('lists the cells of a 90 degree cone', () => {
    const shape = resolveShape(grid, { kind: 'cone', range: 2, angle: 90 }, src, { x: 2, y: 0 })
    const keys = cellsInShape(grid, shape).map(cellKey).sort()
    expect(keys).toEqual(['1,-1', '1,0', '1,1', '2,0'])
  })
})

describe('line', () => {
  it('hits tokens along the strip and not beside it', () => {
    const shape = resolveShape(grid, { kind: 'line', range: 6, width: 1 }, src, { x: 1, y: 0 })
    expect(tokensInShape(shape, tokens, 'src').sort()).toEqual(['a', 'b'])
    expect(pointInShape(shape, { x: 3, y: 0.6 })).toBe(false)
    expect(pointInShape(shape, { x: 6.5, y: 0 })).toBe(false)
  })
  it('extends to full range regardless of the pointer distance', () => {
    const shape = resolveShape(grid, { kind: 'line', range: 8, width: 1 }, src, { x: 0.1, y: 0 })
    expect(tokensInShape(shape, tokens, 'src').sort()).toEqual(['a', 'b', 'd'])
  })
  it('lists the cells of a diagonal line', () => {
    const shape = resolveShape(grid, { kind: 'line', range: 3, width: 1 }, src, { x: 1, y: 1 })
    const keys = cellsInShape(grid, shape).map(cellKey)
    expect(keys).toContain('1,1')
    expect(keys).toContain('2,2')
    expect(keys).not.toContain('3,3')
    expect(keys).not.toContain('2,0')
  })
})

describe('shapeOutline', () => {
  it('draws a wedge from the apex and a rectangle for a line', () => {
    const cone = shapeOutline(resolveShape(grid, { kind: 'cone', range: 2, angle: 90 }, src, { x: 2, y: 0 }))
    expect(cone[0]).toEqual({ x: 0, y: 0 })
    for (const p of cone.slice(1)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(2)
    const line = shapeOutline(resolveShape(grid, { kind: 'line', range: 4, width: 2 }, src, { x: 1, y: 0 }))
    expect(line).toHaveLength(4)
    expect(line.map((p) => p.y).sort()).toEqual([-1, -1, 1, 1])
  })
})
