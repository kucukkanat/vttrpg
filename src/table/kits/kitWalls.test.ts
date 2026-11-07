import { describe, expect, it } from 'vitest'
import { cellKey, chunkOf, encodeTile, type SceneTiles } from '@/core/kits'
import { hasLineOfSight } from '../segments'
import { computeVisibleCells } from '../vision'
import { edgesAround, planWalls } from './autoJoin'
import { kitWalls, tileLevels } from './kitWalls'
import { pieceIndex } from './manifests'
import { sceneOccupancy } from './occupancy'
import { applyPlan, emptyTiles, KAYKIT, lookupFor } from './testKits'

const grid = { type: 'square' as const, cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const put = (t: SceneTiles, x: number, level: number, z: number, slot: 'n' | 'w' | 'v' | 'f', piece: string, rot = 0, variant = 0) => {
  const key = cellKey({ x, level, z, slot })
  ;(t.chunks[chunkOf(x, z)] ??= {})[key] = encodeTile({ kit: 0, piece: pieceIndex(KAYKIT, piece), rot, variant })
}
const at = (x: number, z: number) => ({ x: x * 1.5, z: z * 1.5 })

describe('kit walls per level', () => {
  it('places a wall on its edge in world space, turned', () => {
    const t = emptyTiles()
    put(t, 2, 0, 3, 'n', 'wall', 0)
    put(t, 2, 0, 3, 'w', 'wall', 1)
    const w = kitWalls(t, 0, lookupFor(t), grid)
    const round = (p: { x: number; z: number }) => ({ x: +p.x.toFixed(3), z: +p.z.toFixed(3) })
    const segs = w.sight.map((s) => [round(s.a), round(s.b)].sort((p, q) => p.x - q.x || p.z - q.z))
    // North edge of cells 2..3 at z = 2.5 cells; west edge of cells z 3..4 at x = 1.5 cells.
    expect(segs).toContainEqual([round(at(1.5, 2.5)), round(at(3.5, 2.5))])
    expect(segs).toContainEqual([round(at(1.5, 2.5)), round(at(1.5, 4.5))])
  })

  it('keeps each level to itself', () => {
    const t = emptyTiles()
    put(t, 0, 1, 0, 'n', 'wall')
    expect(kitWalls(t, 0, lookupFor(t), grid).sight).toHaveLength(0)
    expect(kitWalls(t, 1, lookupFor(t), grid).sight).toHaveLength(1)
    expect(tileLevels(t)).toEqual([0, 1])
  })

  it('blocks sight with closed doors only, and movement only with windows', () => {
    const t = emptyTiles()
    put(t, 0, 0, 0, 'n', 'wall-doorway')
    put(t, 4, 0, 0, 'n', 'wall-window-open')
    const closed = kitWalls(t, 0, lookupFor(t), grid)
    expect(closed.doors).toHaveLength(1)
    expect(closed.doors[0]).toMatchObject({ key: '0,0,0,n', open: false, leaf: true, level: 0 })
    // Through the middle of the door and of the window, from the cell south to the cell north.
    const door = [at(0.5, 0.5), at(0.5, -1)] as const
    const win = [at(4.5, 0.5), at(4.5, -1)] as const
    expect(hasLineOfSight(door[0], door[1], closed.sight)).toBe(false)
    expect(hasLineOfSight(win[0], win[1], closed.sight)).toBe(true)
    expect(hasLineOfSight(win[0], win[1], [...closed.sight, ...closed.move])).toBe(false)
    put(t, 0, 0, 0, 'n', 'wall-doorway', 0, 1)
    const open = kitWalls(t, 0, lookupFor(t), grid)
    expect(open.doors[0]!.open).toBe(true)
    expect(hasLineOfSight(door[0], door[1], open.sight)).toBe(true)
    // Straight through from either cell the doorway spans.
    expect(hasLineOfSight(at(0, 0), at(0, -1), open.sight)).toBe(true)
    expect(hasLineOfSight(at(1, 0), at(1, -1), open.sight)).toBe(true)
  })

  it('a room hides the outside from a viewer inside it, on its own level only', () => {
    const empty = emptyTiles()
    const plan = planWalls({ occ: sceneOccupancy(empty, lookupFor(empty)), level: 1, manifest: KAYKIT, add: edgesAround({ x: 0, z: 0 }, { x: 4, z: 4 }) })
    const t = applyPlan(empty, plan)
    const viewer = { x: 1.5 * 1.5, z: 1.5 * 1.5, vision: 6 }
    const upstairs = computeVisibleCells(grid, [viewer], kitWalls(t, 1, lookupFor(t), grid).sight)
    const downstairs = computeVisibleCells(grid, [viewer], kitWalls(t, 0, lookupFor(t), grid).sight)
    expect(upstairs.has('2,2')).toBe(true)
    expect(upstairs.has('2,-2')).toBe(false)
    expect(upstairs.has('6,2')).toBe(false)
    expect(downstairs.has('2,-2')).toBe(true)
  })
})
