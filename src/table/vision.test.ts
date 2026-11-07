import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { cellKey } from './grid'
import { ALL_CELLS, computeVisibleCells, exploredCells, FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, fogRasterLayout, fogStatus, fogStrength, isFogEnabled, rasterizeFog } from './vision'
import type { SceneId } from '@/core/ids'
import type { WallSegment } from './walls'

const grid: GridSpec = { type: 'square', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }

describe('computeVisibleCells', () => {
  it('sees everything in range with no walls', () => {
    const vis = computeVisibleCells(grid, [{ x: 0, z: 0, vision: 2 }], [])
    expect(vis.has('0,0')).toBe(true)
    expect(vis.has('2,0')).toBe(true)
    expect(vis.has('1,1')).toBe(true)
    expect(vis.has('2,2')).toBe(false) // distance 2.83 > 2
    expect(vis.has('3,0')).toBe(false)
  })
  it('is blocked by walls', () => {
    const wall: WallSegment = { a: { x: 0.5, z: -3 }, b: { x: 0.5, z: 3 } }
    const vis = computeVisibleCells(grid, [{ x: 0, z: 0, vision: 3 }], [wall])
    expect(vis.has('-1,0')).toBe(true)
    expect(vis.has('0,2')).toBe(true)
    expect(vis.has('1,0')).toBe(false)
    expect(vis.has('2,1')).toBe(false)
  })
  it('always includes the viewer cell and unions viewers', () => {
    const vis = computeVisibleCells(grid, [{ x: 0, z: 0, vision: 0 }, { x: 5, z: 5, vision: 1 }], [])
    expect([...vis].sort()).toEqual(['0,0', '4,5', '5,4', '5,5', '5,6', '6,5'])
  })
})

describe('rasterizeFog', () => {
  it('paints texels by the state of their cell', () => {
    const layout = fogRasterLayout(grid, { minX: -0.5, minZ: -0.5, maxX: 2.5, maxZ: 0.5 }, 2)
    expect(layout.width).toBe(6)
    expect(layout.height).toBe(2)
    const raster = rasterizeFog(grid, layout, new Set([cellKey({ q: 0, r: 0 })]), new Set([cellKey({ q: 1, r: 0 })]))
    const row = Array.from(raster.data.slice(0, 6))
    expect(row).toEqual([FOG_VISIBLE, FOG_VISIBLE, FOG_EXPLORED, FOG_EXPLORED, FOG_UNEXPLORED, FOG_UNEXPLORED])
  })
})

describe('fog enablement', () => {
  it('follows darkness until the scene has an explicit toggle', () => {
    expect(isFogEnabled({ darkness: 0.5 })).toBe(true)
    expect(isFogEnabled({ darkness: 0 })).toBe(false)
    expect(isFogEnabled({ darkness: 0, fogEnabled: true })).toBe(true)
    expect(isFogEnabled({ darkness: 0.9, fogEnabled: false })).toBe(false)
  })
  it('keeps the legacy darkness-scaled strength and floors it once the toggle is set', () => {
    expect(fogStrength({ darkness: 0.3 })).toBe(0.3)
    expect(fogStrength({ darkness: 0 })).toBe(0)
    expect(fogStrength({ darkness: 0.3, fogEnabled: true })).toBe(0.5)
    expect(fogStrength({ darkness: 0.9, fogEnabled: true })).toBe(0.9)
    expect(fogStrength({ darkness: 0.9, fogEnabled: false })).toBe(0)
  })
  it('describes the fog state in one line', () => {
    const scene = 's' as SceneId
    expect(fogStatus({ darkness: 0 }, undefined)).toBe('fog off')
    expect(fogStatus({ darkness: 0.8 }, undefined)).toBe('fog on · 0 cells explored')
    expect(fogStatus({ darkness: 0.8 }, { scene, revealed: ['0,0'] })).toBe('fog on · 1 cell explored')
    expect(fogStatus({ darkness: 0.8 }, { scene, revealed: new Array(42).fill('x') })).toBe('fog on · 42 cells explored')
    expect(fogStatus({ darkness: 0.8 }, { scene, revealed: [], revealAll: true })).toBe('fog on · all revealed')
  })
  it('treats a full reveal as every cell explored when rasterising', () => {
    const scene = 's' as SceneId
    expect(exploredCells({ scene, revealed: [], revealAll: true })).toBe(ALL_CELLS)
    expect(exploredCells({ scene, revealed: ['0,0'] }).has('0,0')).toBe(true)
    expect(exploredCells(undefined).has('0,0')).toBe(false)
    const layout = fogRasterLayout(grid, { minX: -0.5, minZ: -0.5, maxX: 1.5, maxZ: 0.5 }, 1)
    const r = rasterizeFog(grid, layout, new Set(['0,0']), ALL_CELLS)
    expect(Array.from(r.data)).toEqual([FOG_VISIBLE, FOG_EXPLORED])
  })
  it('keeps cells the brush painted back into fog hidden on a fully revealed map', () => {
    const scene = 's' as SceneId
    const explored = exploredCells({ scene, revealed: [], revealAll: true, hidden: ['1,0'] })
    expect(explored).not.toBe(ALL_CELLS)
    expect(explored.has('0,0')).toBe(true)
    expect(explored.has('1,0')).toBe(false)
    expect(fogStatus({ darkness: 0.8 }, { scene, revealed: [], revealAll: true, hidden: ['1,0'] })).toBe('fog on · all revealed but 1 cell')
    const layout = fogRasterLayout(grid, { minX: -0.5, minZ: -0.5, maxX: 1.5, maxZ: 0.5 }, 1)
    expect(Array.from(rasterizeFog(grid, layout, new Set(), explored).data)).toEqual([FOG_EXPLORED, FOG_UNEXPLORED])
  })
})
