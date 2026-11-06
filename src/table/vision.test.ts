import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { cellKey } from './grid'
import { computeVisibleCells, FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, fogRasterLayout, rasterizeFog } from './vision'
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
