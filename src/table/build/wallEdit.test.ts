import { describe, expect, it } from 'vitest'
import type { Wall } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { SceneId, WallId } from '@/core/ids'
import {
  blockingSegments, docBlockingSegments, endpointsOf, isDrawable, moveBlocked, pointSegmentDistance, sceneWalls, segmentsNear,
  snapWallPoint, wallsNear, wallSummary,
} from './wallEdit'

const grid: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const s1 = 's1' as SceneId
const wall = (id: string, a: [number, number], b: [number, number], door?: Wall['door'], scene = s1): Wall => ({
  id: id as WallId, scene, a: { x: a[0], z: a[1] }, b: { x: b[0], z: b[1] }, ...(door ? { door } : {}),
})

describe('wall editing', () => {
  it('blocks with walls and closed doors only', () => {
    const walls = [wall('w', [0, 0], [3, 0]), wall('closed', [3, 0], [4.5, 0], { open: false }), wall('open', [4.5, 0], [6, 0], { open: true })]
    expect(blockingSegments(walls)).toHaveLength(2)
    expect(moveBlocked({ x: 1, z: -1 }, { x: 1, z: 1 }, blockingSegments(walls))).toBe(true)
    expect(moveBlocked({ x: 3.75, z: -1 }, { x: 3.75, z: 1 }, blockingSegments(walls))).toBe(true)
    expect(moveBlocked({ x: 5.25, z: -1 }, { x: 5.25, z: 1 }, blockingSegments(walls))).toBe(false)
    // Staying put is never blocked, even on a wall.
    expect(moveBlocked({ x: 1, z: 0 }, { x: 1, z: 0 }, blockingSegments(walls))).toBe(false)
  })
  it('merges imported scene walls with drawn ones and filters by scene', () => {
    const all = { a: wall('a', [0, 0], [1, 0]), b: wall('b', [0, 0], [1, 0], undefined, 's2' as SceneId) }
    expect(sceneWalls(all, s1).map((w) => w.id)).toEqual(['a'])
    const segs = docBlockingSegments({ walls: [{ a: { x: 9, z: 9 }, b: { x: 9, z: 10 } }] }, sceneWalls(all, s1))
    expect(segs).toHaveLength(2)
    expect(docBlockingSegments(undefined, [])).toEqual([])
  })
  it('snaps the pen to wall ends first, then to the half-cell lattice', () => {
    const ends = endpointsOf([{ a: { x: 0.1, z: 0.1 }, b: { x: 3, z: 0 } }])
    expect(snapWallPoint({ x: 0.2, z: 0.2 }, grid, ends)).toEqual({ x: 0.1, z: 0.1 })
    // Cell corners of a 1.5 m grid centred on the origin sit at ±0.75, 2.25, …
    expect(snapWallPoint({ x: 0.8, z: 2.1 }, grid, [])).toEqual({ x: 0.75, z: 2.25 })
    expect(snapWallPoint({ x: 0.8, z: 2.1 }, grid, [], { snap: false })).toEqual({ x: 0.8, z: 2.1 })
    expect(snapWallPoint({ x: 0.8, z: 2.1 }, { ...grid, type: 'none' }, [])).toEqual({ x: 0.8, z: 2.1 })
  })
  it('finds walls near a point and ignores taps as strokes', () => {
    const walls = [wall('w', [0, 0], [3, 0]), wall('v', [0, 0], [0, 3])]
    expect(pointSegmentDistance({ x: 1, z: 1 }, { x: 0, z: 0 }, { x: 3, z: 0 })).toBeCloseTo(1)
    expect(pointSegmentDistance({ x: -2, z: 0 }, { x: 0, z: 0 }, { x: 3, z: 0 })).toBeCloseTo(2)
    expect(wallsNear({ x: 1.5, z: 0.2 }, walls, 0.3)).toEqual(['w'])
    expect(wallsNear({ x: 0.1, z: 0.1 }, walls, 0.3)).toEqual(['w', 'v'])
    expect(segmentsNear({ x: 0, z: 2 }, walls, 0.3)).toEqual([1])
    expect(isDrawable({ x: 0, z: 0 }, { x: 0.1, z: 0 }, grid)).toBe(false)
    expect(isDrawable({ x: 0, z: 0 }, { x: 1.5, z: 0 }, grid)).toBe(true)
  })
  it('summarises walls and doors', () => {
    expect(wallSummary([])).toBe('0 walls · 0 doors')
    expect(wallSummary([wall('w', [0, 0], [1, 0]), wall('d', [0, 0], [1, 0], { open: true }), wall('e', [0, 0], [1, 0], { open: false })]))
      .toBe('1 wall · 2 doors (1 open)')
  })
})
