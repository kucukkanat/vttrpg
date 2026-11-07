import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { buildGridGeometry, clipSegment } from './GridOverlay'

const square = { type: 'square', cellSize: 1.5, origin: { x: 0, z: 0 } } as GridSpec
const hex = { type: 'hex', cellSize: 1.5, origin: { x: 0, z: 0 } } as GridSpec
const rect = { minX: -4, minZ: -3, maxX: 4, maxZ: 3 }

describe('clipSegment', () => {
  it('cuts a crossing segment at the rectangle edges', () => {
    expect(clipSegment(-10, 0, 10, 0, rect)).toEqual([-4, 0, 4, 0])
    const d = clipSegment(-10, -10, 10, 10, rect)!
    expect(d[0]).toBeCloseTo(-3); expect(d[1]).toBeCloseTo(-3); expect(d[2]).toBeCloseTo(3); expect(d[3]).toBeCloseTo(3)
  })

  it('keeps an inside segment and drops an outside one', () => {
    expect(clipSegment(-1, 1, 2, 1, rect)).toEqual([-1, 1, 2, 1])
    expect(clipSegment(5, -10, 5, 10, rect)).toBeNull()
  })
})

describe.each([['square', square], ['hex', hex]] as const)('%s grid with a clip', (_name, grid) => {
  it('never draws past the floor', () => {
    const padded = { minX: -5, minZ: -4, maxX: 5, maxZ: 4 }
    const free = buildGridGeometry(grid, padded).getAttribute('position')
    const clipped = buildGridGeometry(grid, padded, rect).getAttribute('position')
    let freeMax = 0
    for (let i = 0; i < free.count; i++) freeMax = Math.max(freeMax, Math.abs(free.getX(i)))
    expect(freeMax).toBeGreaterThan(4)
    expect(clipped.count).toBeGreaterThan(0)
    for (let i = 0; i < clipped.count; i++) {
      expect(Math.abs(clipped.getX(i))).toBeLessThanOrEqual(4 + 1e-6)
      expect(Math.abs(clipped.getZ(i))).toBeLessThanOrEqual(3 + 1e-6)
    }
  })
})
