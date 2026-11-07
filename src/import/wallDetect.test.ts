import { describe, expect, it } from 'vitest'
import { detectionSize, detectWalls, lumaFromRgba, otsuThreshold } from './wallDetect'

const PPC = 10

/** A light map `cols` x `rows` cells at 10 px per cell; `paint` darkens pixels. */
function map(cols: number, rows: number, paint: (x: number, y: number) => boolean) {
  const width = cols * PPC, height = rows * PPC
  const luma = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) luma[y * width + x] = paint(x, y) ? 20 : 210 + ((x * 7 + y * 3) % 30)
  return { luma, width, height, widthCells: cols, heightCells: rows }
}

const sorted = (walls: { a: { x: number; y: number }; b: { x: number; y: number } }[]) =>
  walls.map((w) => `${w.a.x},${w.a.y}-${w.b.x},${w.b.y}`).sort()

describe('wall detection', () => {
  it('finds the edge of a solid area and a thin dark line along the grid', () => {
    const input = map(10, 6, (x, y) => x < PPC || (Math.abs(x - 5 * PPC) <= 1 && y >= PPC && y < 5 * PPC))
    const r = detectWalls(input)
    expect(r.solidCells).toBe(6)
    expect(sorted(r.walls)).toEqual(['1,0-1,6', '5,1-5,5'])
  })
  it('finds horizontal runs and joins neighbouring edges into one segment', () => {
    const input = map(8, 5, (x, y) => Math.abs(y - 2 * PPC) <= 1 && x >= 2 * PPC && x < 6 * PPC)
    expect(sorted(detectWalls(input).walls)).toEqual(['2,2-6,2'])
  })
  it('finds nothing on a plain floor', () => {
    expect(detectWalls(map(6, 4, () => false)).walls).toEqual([])
  })
  it('needs more of an edge dark at low sensitivity', () => {
    // A dashed line: dark on about 60% of its length.
    const input = map(6, 4, (x, y) => Math.abs(x - 3 * PPC) <= 1 && y % 10 < 6)
    expect(detectWalls(input, { sensitivity: 1 }).walls.length).toBeGreaterThan(0)
    expect(detectWalls(input, { sensitivity: 0 }).walls).toEqual([])
  })
  it('clips walls to a fractional last row', () => {
    const input = { ...map(4, 3, (x) => x < PPC), heightCells: 2.5 }
    expect(sorted(detectWalls(input).walls)).toEqual(['1,0-1,2.5'])
  })
  it('computes luma, an Otsu threshold and the detection size', () => {
    expect(Array.from(lumaFromRgba(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1))).toEqual([255, 0, 76])
    const t = otsuThreshold(new Uint8Array([10, 12, 11, 200, 210, 205]))
    expect(t).toBeGreaterThanOrEqual(12)
    expect(t).toBeLessThan(200)
    expect(detectionSize(4000, 2000, 50)).toEqual({ width: 800, height: 400 })
    expect(detectionSize(300, 200, 50)).toEqual({ width: 300, height: 200 })
  })
})
