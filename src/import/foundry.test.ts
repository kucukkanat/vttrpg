import { describe, expect, it } from 'vitest'
import v10 from './__fixtures__/tiny-foundry.json'
import v9 from './__fixtures__/tiny-foundry-v9.json'
import { foundryGridSize, foundryPaddingOffset, isFoundryScene, parseFoundryScene } from './foundry'

describe('parseFoundryScene (v10+ export)', () => {
  const map = parseFoundryScene(v10)

  it('reads size, grid, name, darkness and the background path', () => {
    expect(map.format).toBe('foundry')
    expect(map.name).toBe('Tiny Cellar')
    expect(map.widthCells).toBe(2)
    expect(map.heightCells).toBe(2)
    expect(map.pixelsPerCell).toBe(100)
    expect(map.pixelSize).toEqual({ width: 200, height: 200 })
    expect(map.darkness).toBe(0.6)
    expect(map.imagePath).toBe('worlds/test/maps/tiny-cellar.webp')
    expect(map.image).toBeUndefined()
  })

  it('removes the padding offset and converts pixels to grid units', () => {
    // padding 0.25 * 200 px = 50 px, rounded up to a whole 100 px cell: the background starts at (100, 100)
    expect(foundryPaddingOffset(200, 200, 100, 0.25)).toEqual({ x: 100, y: 100 })
    expect(map.walls).toEqual([
      { a: { x: 0, y: 1 }, b: { x: 1, y: 1 } },
      { a: { x: 1, y: 0 }, b: { x: 1, y: 2 } },
      { a: { x: 1, y: 2 }, b: { x: 2, y: 2 } }, // closed door blocks sight
    ])
  })

  it('drops open doors, sight-transparent walls and zero-length walls, and notes the first two', () => {
    expect(map.walls.length).toBe(3)
    expect(map.notes).toContain('1 open door left as gaps')
    expect(map.notes).toContain('1 wall that do not block sight skipped')
  })

  it('lets a grid size override the file', () => {
    const m = parseFoundryScene(v10, 50)
    expect(m.widthCells).toBe(4)
    // offset becomes ceil(50/50)*50 = 50 px; wall w1 at x 100..200 px -> 1..3 cells
    expect(m.walls[0]).toEqual({ a: { x: 1, y: 3 }, b: { x: 3, y: 3 } })
  })
})

describe('parseFoundryScene (old export: numeric grid, img, sense)', () => {
  const map = parseFoundryScene(v9)
  it('reads the numeric grid and the img path', () => {
    expect(foundryGridSize(v9)).toBe(50)
    expect(map.widthCells).toBe(4)
    expect(map.heightCells).toBe(2)
    expect(map.imagePath).toBe('maps/old.jpg')
  })
  it('uses `sense` when `sight` is absent and applies no padding when padding is 0', () => {
    expect(map.walls).toEqual([{ a: { x: 0, y: 1 }, b: { x: 4, y: 1 } }])
  })
})

describe('validation', () => {
  it('recognises exports and rejects the rest', () => {
    expect(isFoundryScene(v10)).toBe(true)
    expect(isFoundryScene({ resolution: { map_size: { x: 1, y: 1 } }, line_of_sight: [] })).toBe(false)
    expect(() => parseFoundryScene({ name: 'x' })).toThrow(/Not a Foundry/)
    expect(() => parseFoundryScene({ width: 100, height: 100, walls: [] })).toThrow(/grid size/)
    expect(parseFoundryScene({ width: 100, height: 100, walls: [] }, 50).widthCells).toBe(2)
    expect(parseFoundryScene(JSON.stringify(v9)).widthCells).toBe(4)
  })
  it('defaults padding to 0.25 when the export omits it', () => {
    const m = parseFoundryScene({ width: 400, height: 400, grid: 100, walls: [{ c: [100, 100, 500, 100] }] })
    expect(m.walls).toEqual([{ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }])
  })
})
