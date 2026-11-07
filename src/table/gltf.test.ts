import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { createGltfLoader, measureModel, MODEL_BUDGET, overBudget } from './gltf'
import { createGltfLoader as sceneLoaderFactory } from './sceneLoader'
import { warnOverBudget } from './useModel'

vi.mock('@/ui/toasts', () => ({ pushToast: vi.fn() }))

const fakeRenderer = { extensions: { has: () => false, get: () => null } } as never
const CDN = /gstatic|jsdelivr|unpkg|cdnjs|googleapis|https?:\/\//

describe('createGltfLoader', () => {
  it('attaches Draco, meshopt and, with a renderer, KTX2', () => {
    const loader = createGltfLoader({ renderer: fakeRenderer })
    expect(loader.dracoLoader).toBeInstanceOf(DRACOLoader)
    expect(loader.meshoptDecoder).toBe(MeshoptDecoder)
    expect(loader.ktx2Loader).toBeInstanceOf(KTX2Loader)
  })

  it('leaves KTX2 off without a renderer but keeps Draco and meshopt', () => {
    const loader = createGltfLoader()
    expect(loader.ktx2Loader).toBeNull()
    expect(loader.dracoLoader).toBeInstanceOf(DRACOLoader)
    expect(loader.meshoptDecoder).toBe(MeshoptDecoder)
  })

  it('uses the bundled decoders, never a CDN', () => {
    const loader = createGltfLoader({ renderer: fakeRenderer })
    const draco = loader.dracoLoader as unknown as { decoderPath: string; decoderPaths?: Record<string, string | null> }
    expect(draco.decoderPath ?? '').not.toMatch(CDN)
    for (const p of Object.values(draco.decoderPaths ?? {})) if (p) expect(p).not.toMatch(CDN)
    const ktx2 = loader.ktx2Loader as unknown as { transcoderPath: string }
    expect(ktx2.transcoderPath).toBe('')
  })

  it('shares decoder instances between loaders, and the scene loader is the same factory', () => {
    const a = createGltfLoader({ renderer: fakeRenderer })
    const b = sceneLoaderFactory({ renderer: fakeRenderer })
    expect(a.dracoLoader).toBe(b.dracoLoader)
    expect(a.ktx2Loader).toBe(b.ktx2Loader)
  })

  it('parses a meshopt-compressed library model', async () => {
    const entries = JSON.parse(readFileSync(resolve(__dirname, '../../public/library/catalogue.json'), 'utf8')) as Array<{ model: { sources: string[] } }>
    const bytes = readFileSync(resolve(__dirname, '../../public/library', entries[0]!.model.sources[0]!))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const gltf = await createGltfLoader().parseAsync(buffer, '')
    expect(gltf.parser.json.extensionsUsed ?? []).toContain('EXT_meshopt_compression')
    expect(measureModel(gltf.scene, buffer.byteLength).triangles).toBeGreaterThan(0)
  })
})

describe('model budget', () => {
  it('counts triangles and unique texture memory', () => {
    const tex = new DataTexture(new Uint8Array(64 * 32 * 4), 64, 32)
    tex.generateMipmaps = false
    const mat = new MeshStandardMaterial({ map: tex })
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(), mat), new Mesh(new BoxGeometry(), mat))
    const s = measureModel(root, 1234)
    expect(s).toEqual({ triangles: 24, textureBytes: 64 * 32 * 4, bytes: 1234, meshes: 2, textures: 1 })
  })

  it('flags triangles, file size and texture memory over the budget', () => {
    const ok = { triangles: 100, textureBytes: 0, bytes: 10, meshes: 1, textures: 0 }
    expect(overBudget(ok)).toEqual([])
    expect(overBudget({ ...ok, triangles: MODEL_BUDGET.triangles + 1 })).toHaveLength(1)
    expect(overBudget({ ...ok, bytes: MODEL_BUDGET.bytes + 1, textureBytes: MODEL_BUDGET.bytes + 1 })).toHaveLength(2)
  })

  it('warns once per asset and toasts only the GM', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const toast = vi.fn(() => '')
    const heavy = { triangles: 80_000, textureBytes: 0, bytes: 10, meshes: 1, textures: 0 }
    expect(warnOverBudget('sha-a', 'Tree', heavy, true, toast)).toBe(true)
    expect(warnOverBudget('sha-a', 'Tree', heavy, true, toast)).toBe(false)
    expect(warnOverBudget('sha-b', 'Rock', heavy, false, toast)).toBe(true)
    expect(warnOverBudget('sha-c', 'Cup', { ...heavy, triangles: 10 }, true, toast)).toBe(false)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
