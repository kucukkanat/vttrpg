import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import { cellToWorld, worldToCell } from './grid'
import { imageBounds, imageFrame, imageGridToWorld, imagePlaneSize, imageSceneGrid, imageSceneLayout, imageWallsToWorld, layoutForCells, pixelsPerCell } from './imageScene'

describe('imagePlaneSize', () => {
  const grid: GridSpec = imageSceneGrid(1.5)
  const frameFor = (widthCells: number, heightCells: number) =>
    imageFrame(grid, { asset: { sha256: 'x', kind: 'image', mime: 'image/png', size: 0, sources: [] }, widthCells, heightCells } as unknown as Parameters<typeof imageFrame>[1])

  it('is the frame when both sides are known, whatever the pixels say', () => {
    expect(imagePlaneSize(frameFor(16, 12), 1024, 768)).toEqual({ width: 24, height: 18 })
    // a map export declares its own cell counts; the image is stretched to them, never re-derived
    expect(imagePlaneSize(frameFor(16, 10), 1024, 768)).toEqual({ width: 24, height: 15 })
    expect(imagePlaneSize(frameFor(16, 12))).toEqual({ width: 24, height: 18 })
  })
  it('fills a missing height from the image aspect', () => {
    expect(imagePlaneSize(frameFor(16, 0), 1024, 768)).toEqual({ width: 24, height: 18 })
    expect(imagePlaneSize(frameFor(16, Number.NaN), 1024, 768)).toEqual({ width: 24, height: 18 })
    // without pixels there is nothing better than a square
    expect(imagePlaneSize(frameFor(16, 0))).toEqual({ width: 24, height: 24 })
  })
  it('fills a missing width from the image aspect', () => {
    expect(imagePlaneSize(frameFor(0, 12), 1024, 768)).toEqual({ width: 24, height: 18 })
  })
  it('never collapses to nothing', () => {
    const s = imagePlaneSize(frameFor(0, 0), 200, 100)
    expect(s.width).toBeGreaterThan(0)
    expect(s.height).toBeCloseTo(s.width / 2)
  })
})

describe('imageSceneLayout', () => {
  it('derives rows from the aspect ratio and keeps columns', () => {
    const l = imageSceneLayout(16, 1024, 768, 1.5)
    expect(l.widthCells).toBe(16)
    expect(l.heightCells).toBeCloseTo(12)
    // 16 x 12 cells of 1.5 m, top-left cell centred on the origin
    expect(l.offset).toEqual({ x: 11.25, y: 0, z: 8.25 })
  })
  it('allows fractional rows rather than stretching the image', () => {
    const l = imageSceneLayout(10, 1000, 650, 1)
    expect(l.heightCells).toBeCloseTo(6.5)
  })
  it('never produces less than one column', () => {
    expect(imageSceneLayout(0, 100, 100, 1).widthCells).toBe(1)
    expect(imageSceneLayout(-3, 100, 100, 1).widthCells).toBe(1)
  })
  it('reports the pixel pitch of a cell', () => {
    expect(pixelsPerCell(1024, 16)).toBe(64)
  })
})

describe('imageFrame', () => {
  const cellSize = 2
  const grid: GridSpec = imageSceneGrid(cellSize)
  const layout = layoutForCells(4, 3, cellSize)
  const image = { asset: { sha256: 'x', kind: 'image', mime: 'image/png', size: 0, sources: [] }, ...layout } as unknown as Parameters<typeof imageFrame>[1]

  it('sizes the plane in cells times cell size and centres it at origin + offset', () => {
    const f = imageFrame(grid, image)
    expect(f.width).toBe(8)
    expect(f.height).toBe(6)
    expect(f.cx).toBe(3)
    expect(f.cz).toBe(2)
    expect(f.minX).toBe(-1)
    expect(f.minZ).toBe(-1)
    expect(imageBounds(grid, image)).toEqual({ minX: -1, minZ: -1, maxX: 7, maxZ: 5 })
  })
  it('puts the top-left map cell on grid cell (0,0) and aligns the map grid with the table grid', () => {
    const f = imageFrame(grid, image)
    // centre of map cell (col 0, row 0) is half a cell in from the corner
    const c00 = imageGridToWorld(f, 0.5, 0.5)
    expect(c00).toEqual({ x: 0, z: 0 })
    expect(worldToCell(grid, c00.x, c00.z)).toEqual({ q: 0, r: 0 })
    const c31 = imageGridToWorld(f, 3.5, 1.5)
    expect(worldToCell(grid, c31.x, c31.z)).toEqual({ q: 3, r: 1 })
    expect(cellToWorld(grid, { q: 3, r: 1 })).toEqual({ x: c31.x, y: c31.z })
    // the image's bottom-right corner is the far edge of the last cell
    expect(imageGridToWorld(f, 4, 3)).toEqual({ x: f.maxX, z: f.maxZ })
  })
  it('honours an explicit grid origin', () => {
    const g: GridSpec = { type: 'square', cellSize, origin: { x: 10, y: 0, z: -4 } }
    const f = imageFrame(g, image)
    expect(f.cx).toBe(13)
    expect(f.cz).toBe(-2)
  })
  it('moves walls from map units to the world', () => {
    const f = imageFrame(grid, image)
    const walls = imageWallsToWorld(f, [{ a: { x: 0, z: 0 }, b: { x: 4, z: 0 } }, { a: { x: 2, z: 1 }, b: { x: 2, z: 3 } }])
    expect(walls).toEqual([
      { a: { x: -1, z: -1 }, b: { x: 7, z: -1 } },
      { a: { x: 3, z: 1 }, b: { x: 3, z: 5 } },
    ])
  })
})
