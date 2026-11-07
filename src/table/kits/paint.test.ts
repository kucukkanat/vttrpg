import { describe, expect, it } from 'vitest'
import { edgeAt, pickAt } from './KitLayer'
import { edgesAround, planWalls } from './autoJoin'
import { benchDungeon, tileCount } from './bench'
import { pieceIndex } from './manifests'
import { sceneOccupancy } from './occupancy'
import { planEdgePiece, planErase, planFloorRect, planRoofFill, planVertex, snapRect } from './paint'
import { applyPlan, describeTiles, emptyTiles, KAYKIT, KENNEY, lookupFor } from './testKits'

const occOf = (t: ReturnType<typeof emptyTiles>) => sceneOccupancy(t, lookupFor(t))
const piece = (m: typeof KAYKIT, id: string) => m.pieces[pieceIndex(m, id)]!

describe('floor paint', () => {
  it('tiles a rectangle with the big piece and fills the rest with the small one', () => {
    const t = applyPlan(emptyTiles(), planFloorRect(occOf(emptyTiles()), 0, KAYKIT, piece(KAYKIT, 'floor-tile-large'), { x0: 0, z0: 0, x1: 2, z1: 1 }, 0))
    expect(describeTiles(t)).toEqual(['0,0,0,f=floor-tile-large@0', '2,0,0,f=floor-tile-small@0', '2,0,1,f=floor-tile-small@0'])
  })
  it('replaces the floor under it in one stroke', () => {
    const a = applyPlan(emptyTiles(), planFloorRect(occOf(emptyTiles()), 0, KAYKIT, piece(KAYKIT, 'floor-tile-large'), { x0: 0, z0: 0, x1: 3, z1: 3 }, 0))
    const plan = planFloorRect(occOf(a), 0, KAYKIT, piece(KAYKIT, 'floor-wood-small'), { x0: 1, z0: 1, x1: 1, z1: 1 }, 0)
    const b = applyPlan(a, plan)
    // The 2×2 tile that covered (1,1) gives way.
    expect(describeTiles(b)).toContain('1,0,1,f=floor-wood-small@0')
    expect(describeTiles(b)).not.toContain('0,0,0,f=floor-tile-large@0')
  })
  it('grows rectangles to whole modules on a 3 m kit', () => {
    expect(snapRect({ x0: 1, z0: -1, x1: 2, z1: 0 }, 2)).toEqual({ x0: 0, z0: -2, x1: 3, z1: 1 })
  })
})

describe('roof fill', () => {
  it('puts two slopes meeting at the ridge over a room two modules deep', () => {
    const t = applyPlan(emptyTiles(), planRoofFill(occOf(emptyTiles()), 0, KENNEY, { x0: 0, z0: 0, x1: 5, z1: 3 }))
    const d = describeTiles(t)
    expect(d).toHaveLength(6)
    expect(d.every((s) => s.includes(',1,') && s.includes('=roof@'))).toBe(true)
    expect(d).toContain('0,1,0,r=roof@3')
    expect(d).toContain('0,1,2,r=roof@1')
  })
  it('uses gable pieces over a room one module deep, and a ceiling of floor on a kit without roofs', () => {
    const k = applyPlan(emptyTiles(), planRoofFill(occOf(emptyTiles()), 0, KENNEY, { x0: 0, z0: 0, x1: 5, z1: 1 }))
    expect(describeTiles(k).every((s) => s.includes('roof-gable@0'))).toBe(true)
    const d = applyPlan(emptyTiles(), planRoofFill(occOf(emptyTiles()), 2, KAYKIT, { x0: 0, z0: 0, x1: 1, z1: 1 }))
    expect(describeTiles(d)).toEqual(['0,3,0,f=floor-tile-large@0'])
  })
})

describe('pillars, decor walls and erase', () => {
  it('places a pillar on a vertex and a decor wall over a plain one', () => {
    const run = applyPlan(emptyTiles(), planWalls({ occ: occOf(emptyTiles()), level: 0, manifest: KAYKIT, add: edgesAround({ x: 0, z: 0 }, { x: 4, z: 0 }) }))
    const p = applyPlan(run, planVertex(occOf(run), 0, KAYKIT, piece(KAYKIT, 'pillar'), { x: 9, z: 9 }, 0))
    expect(describeTiles(p)).toContain('9,0,9,v=pillar@0')
    const shelves = applyPlan(run, planEdgePiece(occOf(run), 0, KAYKIT, piece(KAYKIT, 'wall-shelves'), { x: 1, z: 0, side: 'n' }))
    expect(describeTiles(shelves)).toEqual(['0,0,0,n=wall-shelves@0', '2,0,0,n=wall@0'])
  })
  it('erases a rectangle: floors in it go and walls on it re-join around the gap', () => {
    let t = applyPlan(emptyTiles(), planFloorRect(occOf(emptyTiles()), 0, KAYKIT, piece(KAYKIT, 'floor-tile-small'), { x0: 0, z0: 0, x1: 3, z1: 3 }, 0))
    t = applyPlan(t, planWalls({ occ: occOf(t), level: 0, manifest: KAYKIT, add: edgesAround({ x: 0, z: 0 }, { x: 4, z: 4 }) }))
    const before = describeTiles(t).length
    const after = applyPlan(t, planErase({ occ: occOf(t), level: 0, manifest: KAYKIT, rect: { x0: 0, z0: 0, x1: 0, z1: 0 } }))
    const d = describeTiles(after)
    expect(d).not.toContain('0,0,0,f=floor-tile-small@0')
    expect(d.some((s) => s.startsWith('0,0,0,v='))).toBe(false)
    expect(d.length).toBeLessThan(before)
    // Picking the piece under a click: an edge near a grid line, else the floor.
    const occ = occOf(after)
    expect(pickAt(occ, 0, 2, 2)?.piece.id).toBe('floor-tile-small')
    expect(pickAt(occ, 0, 3, 3.45)?.piece.id).toMatch(/wall/)
    expect(edgeAt(2.1, 3.4)).toEqual({ edge: { x: 2, z: 4, side: 'n' }, dist: expect.closeTo(0.1, 5) })
  })
})

describe('benchmark dungeon', () => {
  it('builds joined rooms on two levels', () => {
    const t = benchDungeon(KAYKIT, 3, 2)
    const d = describeTiles({ ...t, kits: ['kaykit-dungeon', 'kenney-town'] })
    expect(tileCount(t)).toBeGreaterThan(100)
    expect(d.some((s) => s.includes('wall-crossing'))).toBe(true)
    expect(d.some((s) => s.includes('wall-tsplit'))).toBe(true)
    expect(d.some((s) => s.includes(',1,') && s.includes('wall-doorway'))).toBe(true)
  })
})
