import { describe, expect, it, vi } from 'vitest'
import type { AssetRef } from '@/core/assets'
import type { Intent } from '@/core/intents'
import type { AssetHash } from '@/core/ids'
import uvtt from './__fixtures__/tiny.dd2vtt.json'
import foundry from './__fixtures__/tiny-foundry.json'
import { detectMapFormat, importSceneFile, parseMapJson } from './importSceneFile'
import { createImageScene } from './mapImage'
import { buildImageScene, sceneFromParsedMap } from './scene'
import { parseUvtt } from './uvtt'

function stubController() {
  const intents: Intent[] = []
  const imported: File[] = []
  const importFile = vi.fn(async (file: File): Promise<AssetRef> => {
    imported.push(file)
    return { sha256: `sha-${file.name}` as AssetHash, kind: 'image', mime: file.type, size: file.size, name: file.name, sources: [] }
  })
  const dispatch = vi.fn(async (intent: Intent) => { intents.push(intent) })
  return { controller: { assets: { importFile }, dispatch }, intents, imported, importFile }
}

const PNG: AssetRef = { sha256: 'png' as AssetHash, kind: 'image', mime: 'image/png', size: 1, name: 'map.png', sources: [] }

describe('buildImageScene', () => {
  it('lays the image out with the top-left cell on (0,0) and scales walls to world units', () => {
    const scene = buildImageScene({ name: 'm', asset: PNG, widthCells: 2, heightCells: 2, cellSize: 1.5, walls: [{ a: { x: 0, y: 1 }, b: { x: 2, y: 1 } }] })
    expect(scene.model).toBeUndefined()
    expect(scene.grid).toEqual({ type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } })
    expect(scene.image).toEqual({ asset: PNG, widthCells: 2, heightCells: 2, offset: { x: 0.75, y: 0, z: 0.75 } })
    // map y = 1 (between the two rows) is the boundary between cell rows 0 and 1: z = 0.75
    expect(scene.walls).toEqual([{ a: { x: -0.75, z: 0.75 }, b: { x: 2.25, z: 0.75 } }])
    expect(scene.cameraMode).toBe('orbit')
    expect(scene.darkness).toBe(0.8)
  })
  it('omits walls when there are none', () => {
    expect(buildImageScene({ name: 'm', asset: PNG, widthCells: 1, heightCells: 1, cellSize: 1 }).walls).toBeUndefined()
  })
})

describe('sceneFromParsedMap', () => {
  it('uses the parsed size, walls, name and darkness', () => {
    const parsed = parseUvtt(uvtt, { name: 'tiny' })
    const scene = sceneFromParsedMap(parsed, PNG, { cellSize: 2 })
    expect(scene.name).toBe('tiny')
    expect(scene.image!.widthCells).toBe(2)
    expect(scene.walls!.length).toBe(4)
    // wall from (0,1)-(1,1) in grid units -> x from -1 to 1 at z = 1 (cell size 2, corner at -1)
    expect(scene.walls![0]).toEqual({ a: { x: -1, z: 1 }, b: { x: 1, z: 1 } })
  })
})

describe('importSceneFile', () => {
  it('imports a .dd2vtt: embedded image through importFile, walls in world units, add + activate', async () => {
    const { controller, intents, imported } = stubController()
    const file = new File([JSON.stringify(uvtt)], 'tiny.dd2vtt', { type: 'application/octet-stream' })
    const result = await importSceneFile(file, controller, { cellSize: 1 })
    expect(result).not.toBeNull()
    expect(imported.length).toBe(1)
    expect(imported[0]!.name).toBe('tiny.png')
    expect(imported[0]!.type).toBe('image/png')
    expect(imported[0]!.size).toBe(77)
    const scene = result!.scene
    expect(scene.image!.asset.sha256).toBe('sha-tiny.png')
    expect(scene.image!.widthCells).toBe(2)
    expect(scene.walls).toEqual([
      { a: { x: -0.5, z: 0.5 }, b: { x: 0.5, z: 0.5 } },
      { a: { x: 0.5, z: 0.5 }, b: { x: 0.5, z: 1.5 } },
      { a: { x: 1.5, z: -0.5 }, b: { x: 1.5, z: 1.5 } },
      { a: { x: 0.5, z: 0.5 }, b: { x: 1.5, z: 0.5 } },
    ])
    expect(intents.map((i) => i.type)).toEqual(['scene.add', 'scene.activate'])
    expect(intents[1]).toEqual({ type: 'scene.activate', scene: scene.id })
    expect(result!.notes).toContain('1 open portal left as gaps')
  })

  it('asks for the image on a Foundry export and imports the picked file', async () => {
    const { controller, intents, imported } = stubController()
    const picked = new File([new Uint8Array([1, 2, 3])], 'cellar.webp', { type: 'image/webp' })
    const pickImage = vi.fn(async () => picked)
    const file = new File([JSON.stringify(foundry)], 'tiny-cellar.json', { type: 'application/json' })
    const result = await importSceneFile(file, controller, { cellSize: 1.5, pickImage })
    expect(pickImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tiny Cellar', imagePath: 'worlds/test/maps/tiny-cellar.webp', format: 'foundry', pixelSize: { width: 200, height: 200 } }))
    expect(imported).toEqual([picked])
    expect(result!.scene.name).toBe('Tiny Cellar')
    expect(result!.scene.darkness).toBe(0.6)
    expect(result!.scene.walls!.length).toBe(3)
    expect(intents.length).toBe(2)
  })

  it('returns null and changes nothing when the image prompt is cancelled', async () => {
    const { controller, intents, imported } = stubController()
    const file = new File([JSON.stringify(foundry)], 'tiny-cellar.json', { type: 'application/json' })
    expect(await importSceneFile(file, controller, { cellSize: 1, pickImage: async () => null })).toBeNull()
    expect(imported).toEqual([])
    expect(intents).toEqual([])
  })

  it('fails readably without an image hook, on bad JSON and on unknown documents', async () => {
    const { controller } = stubController()
    await expect(importSceneFile(new File([JSON.stringify(foundry)], 'f.json'), controller, { cellSize: 1 })).rejects.toThrow(/chosen separately/)
    await expect(importSceneFile(new File(['{oops'], 'f.json'), controller, { cellSize: 1 })).rejects.toThrow(/not valid JSON/)
    await expect(importSceneFile(new File(['{"a":1}'], 'f.json'), controller, { cellSize: 1 })).rejects.toThrow(/not a Universal VTT/)
  })
})

describe('detectMapFormat / parseMapJson', () => {
  it('goes by extension first, then by content', () => {
    expect(detectMapFormat('a.dd2vtt', {})).toBe('uvtt')
    expect(detectMapFormat('a.UVTT', {})).toBe('uvtt')
    expect(detectMapFormat('a.json', uvtt)).toBe('uvtt')
    expect(detectMapFormat('a.json', foundry)).toBe('foundry')
    expect(detectMapFormat('a.json', { x: 1 })).toBeNull()
    expect(parseMapJson('a.json', foundry).format).toBe('foundry')
    expect(() => parseMapJson('a.json', {})).toThrow(/not a Universal VTT/)
  })
})

describe('createImageScene', () => {
  it('builds a scene from a plain image and a column count (the Owlbear path)', async () => {
    const { controller, intents } = stubController()
    const file = new File([new Uint8Array([1])], 'owlbear-map.png', { type: 'image/png' })
    const scene = await createImageScene(file, controller, { columns: 20, cellSize: 1.5 }, { width: 1000, height: 750 })
    expect(scene.name).toBe('owlbear-map')
    expect(scene.image!.widthCells).toBe(20)
    expect(scene.image!.heightCells).toBeCloseTo(15)
    expect(scene.walls).toBeUndefined()
    expect(intents.map((i) => i.type)).toEqual(['scene.add', 'scene.activate'])
  })
})
