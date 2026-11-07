import { describe, expect, it } from 'vitest'
import { edgeKey, edgesOfArms, edgesOfEdgePiece, isEdgeSlot, parseTile } from '@/core/kits'
import { edgesAlong, edgesAround, isPlainWall, joinFor, planWalls } from './autoJoin'
import { sceneOccupancy } from './occupancy'
import { applyPlan, describeTiles, emptyTiles, KAYKIT, KENNEY, lookupFor } from './testKits'

const paint = (tiles = emptyTiles(), job: Partial<Parameters<typeof planWalls>[0]> = {}, manifest = KAYKIT) => {
  const lookup = lookupFor(tiles)
  const plan = planWalls({ occ: sceneOccupancy(tiles, lookup), level: 0, manifest, ...job })
  return { plan, tiles: applyPlan(tiles, plan) }
}

/** Every edge covered by a wall piece on level 0, as edge keys. */
function wallEdges(tiles: ReturnType<typeof emptyTiles>): string[] {
  const occ = sceneOccupancy(tiles, lookupFor(tiles))
  const out: string[] = []
  for (const o of occ.pieces(0)) {
    const edges = isEdgeSlot(o.piece.slot) ? edgesOfEdgePiece(o.piece, o.at, o.value.rot) : edgesOfArms(o.piece, o.at, o.value.rot)
    out.push(...edges.map(edgeKey))
  }
  return out.sort()
}

describe('joinFor', () => {
  it('picks the corner, tee and cross and turns them to fit', () => {
    expect(joinFor(KAYKIT, ['W', 'S'])).toMatchObject({ piece: { id: 'wall-corner' }, rot: 0 })
    expect(joinFor(KAYKIT, ['E', 'S'])?.piece.id).toBe('wall-corner')
    const ne = joinFor(KAYKIT, ['N', 'E'])!
    expect(ne.piece.arms!.map((a) => a.dir)).toEqual(['W', 'S'])
    expect(ne.rot).toBe(2)
    expect(joinFor(KAYKIT, ['E', 'W', 'N'])).toMatchObject({ piece: { id: 'wall-tsplit' } })
    expect(joinFor(KAYKIT, ['E', 'N', 'W', 'S'])).toMatchObject({ piece: { id: 'wall-crossing' } })
  })
  it('has no join for a straight run or a wall end', () => {
    expect(joinFor(KAYKIT, ['E', 'W'])).toBeNull()
    expect(joinFor(KAYKIT, ['E'])).toBeNull()
    expect(joinFor(KENNEY, ['E', 'W', 'S'])).toBeNull()
  })
})

describe('planWalls', () => {
  it('lays a straight run in full walls and a half for the odd end', () => {
    const { tiles } = paint(undefined, { add: edgesAlong({ x: 0, z: 0 }, { x: 5, z: 0 }) })
    expect(describeTiles(tiles)).toEqual(['0,0,0,n=wall@0', '2,0,0,n=wall@0', '4,0,0,n=wall-half@0'])
    expect(wallEdges(tiles)).toEqual(edgesAlong({ x: 0, z: 0 }, { x: 5, z: 0 }).map(edgeKey).sort())
  })

  it('puts corners on a room outline and covers every edge exactly once', () => {
    const outline = edgesAround({ x: 0, z: 0 }, { x: 4, z: 3 })
    const { tiles } = paint(undefined, { add: outline })
    const names = describeTiles(tiles)
    expect(names.filter((n) => n.includes('wall-corner'))).toHaveLength(4)
    expect(wallEdges(tiles)).toEqual(outline.map(edgeKey).sort())
  })

  it('turns a corner into a tee when a wall joins it, as one stroke', () => {
    const room = paint(undefined, { add: edgesAround({ x: 0, z: 0 }, { x: 4, z: 4 }) }).tiles
    // A wall from the middle of the north side going north: the vertex (2, 0) becomes a tee.
    const { plan, tiles } = paint(room, { add: edgesAlong({ x: 2, z: 0 }, { x: 2, z: -2 }) })
    expect(describeTiles(tiles)).toContain('2,0,0,v=wall-tsplit@2')
    expect(plan.keys.length).toBeGreaterThan(0)
    expect(plan.keys.length).toBeLessThan(10)
    expect(wallEdges(tiles)).toEqual([...edgesAround({ x: 0, z: 0 }, { x: 4, z: 4 }), ...edgesAlong({ x: 2, z: -2 }, { x: 2, z: 0 })].map(edgeKey).sort())
  })

  it('makes a cross where two walls cross', () => {
    const a = paint(undefined, { add: edgesAlong({ x: -2, z: 0 }, { x: 2, z: 0 }) }).tiles
    const b = paint(a, { add: edgesAlong({ x: 0, z: -2 }, { x: 0, z: 2 }) }).tiles
    expect(describeTiles(b)).toContain('0,0,0,v=wall-crossing@0')
  })

  it('places a door in a wall and keeps the rest of the run as wall', () => {
    const run = paint(undefined, { add: edgesAlong({ x: 0, z: 0 }, { x: 6, z: 0 }) }).tiles
    const door = KAYKIT.pieces.find((p) => p.id === 'wall-doorway')!
    const { tiles } = paint(run, { fixed: [{ piece: door, at: { x: 2, z: 0 }, rot: 0 }] })
    const names = describeTiles(tiles)
    expect(names).toContain('2,0,0,n=wall-doorway@0')
    expect(wallEdges(tiles)).toEqual(edgesAlong({ x: 0, z: 0 }, { x: 6, z: 0 }).map(edgeKey).sort())
  })

  it('erasing an edge splits the run and drops a door on it', () => {
    const run = paint(undefined, { add: edgesAlong({ x: 0, z: 0 }, { x: 6, z: 0 }) }).tiles
    const door = KAYKIT.pieces.find((p) => p.id === 'wall-doorway')!
    const withDoor = paint(run, { fixed: [{ piece: door, at: { x: 2, z: 0 }, rot: 0 }] }).tiles
    const { tiles } = paint(withDoor, { remove: [{ x: 3, z: 0, side: 'n' }] })
    expect(describeTiles(tiles).some((n) => n.includes('doorway'))).toBe(false)
    expect(wallEdges(tiles)).toEqual(['0,0,n', '1,0,n', '4,0,n', '5,0,n'])
  })

  it('does not touch walls on other levels', () => {
    const lower = paint(undefined, { add: edgesAlong({ x: 0, z: 0 }, { x: 4, z: 0 }) }).tiles
    const lookup = lookupFor(lower)
    const plan = planWalls({ occ: sceneOccupancy(lower, lookup), level: 1, manifest: KAYKIT, add: edgesAlong({ x: 0, z: 0 }, { x: 4, z: 0 }) })
    expect(plan.keys.every((k) => k.split(',')[1] === '1')).toBe(true)
  })

  it('faces one-sided walls towards the floor', () => {
    const { tiles } = paint(undefined, {
      add: edgesAlong({ x: 0, z: 0 }, { x: 2, z: 0 }),
      floorAt: (_x, z) => z === -1,
    }, KENNEY)
    const [only] = describeTiles(tiles)
    expect(only).toBe('0,0,0,n=wall@2')
  })

  it('Kenney corners take two cells per arm', () => {
    const { tiles } = paint(undefined, { add: edgesAround({ x: 0, z: 0 }, { x: 4, z: 4 }) }, KENNEY)
    const names = describeTiles(tiles)
    expect(names.filter((n) => n.includes('wall-corner'))).toHaveLength(4)
    expect(names.filter((n) => n.includes('=wall@'))).toHaveLength(0)
    expect(wallEdges(tiles)).toEqual(edgesAround({ x: 0, z: 0 }, { x: 4, z: 4 }).map(edgeKey).sort())
  })

  it('knows the plain walls of each kit', () => {
    const tiles = paint(undefined, { add: edgesAround({ x: 0, z: 0 }, { x: 2, z: 2 }) }).tiles
    const occ = sceneOccupancy(tiles, lookupFor(tiles))
    expect([...occ.pieces(0)].every(isPlainWall)).toBe(true)
    const v = parseTile(Object.values(tiles.chunks)[0]!['0,0,0,v']!)
    expect(v?.rot).toBeDefined()
  })
})
