import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/tiny.dd2vtt.json'
import { decodeImage, isUvtt, parseUvtt, sniffImage } from './uvtt'

describe('parseUvtt', () => {
  const map = parseUvtt(fixture, { name: 'tiny.dd2vtt' })

  it('reads the size in cells and the pixel pitch', () => {
    expect(map.format).toBe('uvtt')
    expect(map.widthCells).toBe(2)
    expect(map.heightCells).toBe(2)
    expect(map.pixelsPerCell).toBe(1)
    expect(map.pixelSize).toEqual({ width: 2, height: 2 })
    expect(map.name).toBe('tiny.dd2vtt')
  })

  it('turns polylines and object walls into segments and portals into doors, open or closed', () => {
    expect(map.walls).toEqual([
      { a: { x: 0, y: 1 }, b: { x: 1, y: 1 } },
      { a: { x: 1, y: 1 }, b: { x: 1, y: 2 } },
      { a: { x: 2, y: 0 }, b: { x: 2, y: 2 } },
      { a: { x: 1, y: 1 }, b: { x: 2, y: 1 }, door: { open: false } },
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, door: { open: true } },
    ])
  })

  it('ignores lights but says so', () => {
    expect(map.notes.some((n) => n.includes('1 map light ignored'))).toBe(true)
  })

  it('decodes the embedded image and sniffs its type', () => {
    expect(map.image).toBeDefined()
    expect(map.image!.mime).toBe('image/png')
    expect(map.image!.name).toBe('tiny.png')
    expect(map.image!.bytes.length).toBe(77)
    expect([...map.image!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('shifts coordinates by map_origin', () => {
    const shifted = parseUvtt({ ...fixture, resolution: { ...fixture.resolution, map_origin: { x: 10, y: 5 } }, portals: [], objects_line_of_sight: [] })
    expect(shifted.walls[0]).toEqual({ a: { x: -10, y: -4 }, b: { x: -9, y: -4 } })
  })

  it('accepts raw JSON text and rejects other documents', () => {
    expect(parseUvtt(JSON.stringify(fixture)).widthCells).toBe(2)
    expect(() => parseUvtt({ hello: 'world' })).toThrow(/Not a Universal VTT/)
    expect(() => parseUvtt({ ...fixture, resolution: { map_size: { x: 0, y: 2 } } })).toThrow(/positive/)
    expect(isUvtt(fixture)).toBe(true)
    expect(isUvtt({ width: 1, height: 1, walls: [] })).toBe(false)
  })

  it('notes a missing image', () => {
    const { image, ...rest } = fixture
    void image
    const noImage = parseUvtt(rest)
    expect(noImage.image).toBeUndefined()
    expect(noImage.notes).toContain('no embedded image')
  })
})

describe('decodeImage / sniffImage', () => {
  it('strips data URL prefixes and whitespace', () => {
    const img = decodeImage(`data:image/png;base64,${fixture.image.slice(0, 20)}\n${fixture.image.slice(20)}`, 'x.uvtt')
    expect(img.bytes.length).toBe(77)
    expect(img.name).toBe('x.png')
  })
  it('recognises JPEG and WebP magic bytes and falls back to PNG', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' })
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffImage(webp)).toEqual({ mime: 'image/webp', ext: 'webp' })
    expect(sniffImage(new Uint8Array([1, 2, 3, 4]))).toEqual({ mime: 'image/png', ext: 'png' })
  })
})
