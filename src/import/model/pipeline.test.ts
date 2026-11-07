import { beforeAll, describe, expect, it } from 'vitest'
import type { AssetRef } from '@/core/assets'
import { prepareModel, readFiles, storeModel } from './pipeline'
import { measureGlb, readGlbAttribution } from './optimise'
import { collectModelSet, sniffFormat } from './formats'
import { MAX_IMPORT_BYTES, ModelImportError, type ImportMeta, type InputFile } from './types'

// GLTFExporter writes GLBs through FileReader, which Node does not have.
beforeAll(() => {
  if (typeof (globalThis as { FileReader?: unknown }).FileReader !== 'undefined') return
  class NodeFileReader {
    result: ArrayBuffer | string | null = null
    onload: ((e: unknown) => void) | null = null
    onloadend: ((e: unknown) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    readAsArrayBuffer(b: Blob) {
      b.arrayBuffer().then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }) }, (e) => this.onerror?.(e))
    }
    readAsDataURL(b: Blob) {
      b.arrayBuffer().then((r) => {
        this.result = `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`
        this.onload?.({ target: this }); this.onloadend?.({ target: this })
      }, (e) => this.onerror?.(e))
    }
  }
  ;(globalThis as { FileReader?: unknown }).FileReader = NodeFileReader
})

const enc = new TextEncoder()
const stubThumb = async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

/** A cube OBJ, `size` units on a side, sitting with its min corner at `offset`. */
function cubeObj(size: number, offset: [number, number, number] = [0, 0, 0]): string {
  const v: string[] = []
  for (const x of [0, size]) for (const y of [0, size]) for (const z of [0, size]) v.push(`v ${x + offset[0]} ${y + offset[1]} ${z + offset[2]}`)
  // vertices indexed 1..8 as (x,y,z) bits 4,2,1
  const f = ['1 2 4', '1 4 3', '5 7 8', '5 8 6', '1 5 6', '1 6 2', '3 4 8', '3 8 7', '1 3 7', '1 7 5', '2 6 8', '2 8 4']
  return ['# cube', 'o Cube', ...v, ...f.map((t) => `f ${t}`)].join('\n')
}

/** A binary STL box (12 triangles) w × d × h millimetres, Z up. */
function boxStl(w: number, d: number, h: number): Uint8Array {
  const tris: number[][][] = []
  const p = (x: number, y: number, z: number) => [x * w, y * d, z * h]
  const quad = (a: number[], b: number[], c: number[], e: number[]) => { tris.push([a, b, c], [a, c, e]) }
  quad(p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0))
  quad(p(0, 0, 1), p(0, 1, 1), p(1, 1, 1), p(1, 0, 1))
  quad(p(0, 0, 0), p(0, 0, 1), p(1, 0, 1), p(1, 0, 0))
  quad(p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1))
  quad(p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1))
  quad(p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0))
  const buf = new ArrayBuffer(84 + tris.length * 50)
  const dv = new DataView(buf)
  dv.setUint32(80, tris.length, true)
  tris.forEach((t, i) => {
    const o = 84 + i * 50
    t.forEach((v, j) => v.forEach((c, k) => dv.setFloat32(o + 12 + j * 12 + k * 4, c, true)))
  })
  return new Uint8Array(buf)
}

const meta = (over: Partial<ImportMeta> = {}): ImportMeta => ({
  origin: 'upload', title: 'Test cube', category: 'container', licence: { id: 'own-work' }, ...over,
})

describe('formats', () => {
  it('sniffs GLB, STL and OBJ from bytes', () => {
    expect(sniffFormat(enc.encode('glTF\x02\x00\x00\x00'))).toBe('glb')
    expect(sniffFormat(boxStl(10, 10, 10))).toBe('stl')
    expect(sniffFormat(enc.encode(cubeObj(1)))).toBe('obj')
  })

  it('picks the model out of companions and rejects unsupported files', async () => {
    const set = await collectModelSet([
      { name: 'textures/wood.png', bytes: new Uint8Array(4) },
      { name: 'chair.obj', bytes: enc.encode(cubeObj(1)) },
      { name: 'chair.mtl', bytes: enc.encode('newmtl a') },
    ])
    expect(set.format).toBe('obj')
    expect(set.main.name).toBe('chair.obj')
    await expect(collectModelSet([{ name: 'tavern.blend', bytes: new Uint8Array(10) }])).rejects.toMatchObject({ code: 'unsupported', message: expect.stringMatching(/Blender/) })
    await expect(collectModelSet([])).rejects.toMatchObject({ code: 'empty' })
  })

  it('rejects selections over the 100 MB limit before reading them', async () => {
    const huge = { size: MAX_IMPORT_BYTES + 1, name: 'big.glb', arrayBuffer: () => { throw new Error('should not read') } } as unknown as File
    await expect(readFiles([huge])).rejects.toMatchObject({ code: 'too-large' })
    const fake: InputFile = { name: 'big.glb', bytes: { byteLength: MAX_IMPORT_BYTES + 1 } as Uint8Array }
    await expect(prepareModel([fake], meta(), { useWorker: false, renderThumbnail: stubThumb })).rejects.toMatchObject({ code: 'too-large' })
  })

  it('reports corrupt files clearly', async () => {
    const err = await prepareModel([{ name: 'broken.glb', bytes: enc.encode('glTF garbage here') }], meta(), { useWorker: false, renderThumbnail: stubThumb }).catch((e) => e)
    expect(err).toBeInstanceOf(ModelImportError)
    expect(err.code).toBe('corrupt')
  })
})

describe('prepareModel', () => {
  it('converts an OBJ in centimetres to a metre-scale GLB with the pivot at the bottom centre', async () => {
    const progress: string[] = []
    const prepared = await prepareModel(
      [{ name: 'crate.obj', bytes: enc.encode(cubeObj(60, [100, 20, -40])) }],
      meta({ title: 'Crate' }),
      { useWorker: false, tier: 'desktop', renderThumbnail: stubThumb, onProgress: (p) => progress.push(p.stage) },
    )
    expect(prepared.sizeGuess.reason).toBe('centimetres')
    expect(prepared.entry.size).toEqual([0.6, 0.6, 0.6])
    expect(prepared.entry.triangles).toBe(12)
    expect(prepared.entry.id).toMatch(/^upload:[0-9a-f]{64}$/)
    expect(prepared.entry.origin).toBe('upload')
    expect(progress).toContain('optimise')
    expect(progress).toContain('thumbnail')

    const m = await measureGlb(prepared.glb)
    expect(m.min[1]).toBeCloseTo(0, 2)
    expect((m.min[0] + m.max[0]) / 2).toBeCloseTo(0, 2)
    expect((m.min[2] + m.max[2]) / 2).toBeCloseTo(0, 2)
    expect(m.max[1] - m.min[1]).toBeCloseTo(0.6, 2)
  })

  it('reads a binary STL as millimetres, Z up, and stands it on Y', async () => {
    // 400 × 300 mm footprint, 800 mm tall (Z).
    const prepared = await prepareModel([{ name: 'pillar.stl', bytes: boxStl(400, 300, 800) }], meta({ title: 'Pillar', category: 'structure' }), { useWorker: false, renderThumbnail: stubThumb })
    expect(prepared.sizeGuess.reason).toBe('millimetres')
    const [x, y, z] = prepared.entry.size
    expect(x).toBeCloseTo(0.4, 3)
    expect(y).toBeCloseTo(0.8, 3)
    expect(z).toBeCloseTo(0.3, 3)
    const m = await measureGlb(prepared.glb)
    expect(m.min[1]).toBeCloseTo(0, 2)
    expect(m.max[1]).toBeCloseTo(0.8, 2)
  })

  it('embeds the licence and author in asset.extras', async () => {
    const prepared = await prepareModel(
      [{ name: 'c.obj', bytes: enc.encode(cubeObj(1)) }],
      meta({ origin: 'sketchfab', sourceId: 'abc123', licence: { id: 'cc-by', author: 'Ann Artist', source: 'Sketchfab', sourceUrl: 'https://sketchfab.com/3d-models/abc123' } }),
      { useWorker: false, renderThumbnail: stubThumb },
    )
    expect(prepared.entry.id).toBe('sketchfab:abc123')
    const extras = await readGlbAttribution(prepared.glb)
    expect(extras?.copyright).toContain('Ann Artist')
    expect(extras?.licence).toMatchObject({ id: 'cc-by', author: 'Ann Artist', source: 'Sketchfab' })
    expect(extras?.attribution).toMatchObject({ spdx: 'CC-BY-4.0', title: 'Test cube' })
  })

  it('refuses a non-shareable licence before doing any work', async () => {
    const bad = meta({ licence: { id: 'cc-by-nc' as never } })
    await expect(prepareModel([{ name: 'c.obj', bytes: enc.encode(cubeObj(1)) }], bad, { useWorker: false, renderThumbnail: stubThumb })).rejects.toMatchObject({ code: 'licence' })
    const noAuthor = meta({ licence: { id: 'cc-by-sa' } })
    await expect(prepareModel([{ name: 'c.obj', bytes: enc.encode(cubeObj(1)) }], noAuthor, { useWorker: false, renderThumbnail: stubThumb })).rejects.toMatchObject({ code: 'licence' })
  })

  it('simplifies meshes over the triangle budget', async () => {
    // A 120 × 120 grid of quads (28,800 triangles) folded into a bumpy sheet, over the phone budget.
    const n = 120
    const lines: string[] = []
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) lines.push(`v ${i / n} ${Math.sin(i / 7) * Math.cos(j / 9) * 0.1} ${j / n}`)
    const at = (i: number, j: number) => i * (n + 1) + j + 1
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) lines.push(`f ${at(i, j)} ${at(i, j + 1)} ${at(i + 1, j + 1)}`, `f ${at(i, j)} ${at(i + 1, j + 1)} ${at(i + 1, j)}`)
    const prepared = await prepareModel([{ name: 'sheet.obj', bytes: enc.encode(lines.join('\n')) }], meta({ category: 'nature' }), { useWorker: false, tier: 'phone', renderThumbnail: stubThumb })
    expect(prepared.stats.sourceTriangles).toBe(n * n * 2)
    expect(prepared.stats.simplified).toBe(true)
    expect(prepared.entry.triangles).toBeLessThanOrEqual(15_000)
  })
})

describe('storeModel', () => {
  it('stores the GLB and thumbnail through importFile and applies the size correction', async () => {
    const prepared = await prepareModel([{ name: 'c.obj', bytes: enc.encode(cubeObj(1)) }], meta(), { useWorker: false, renderThumbnail: stubThumb })
    const stored: File[] = []
    const assets = {
      importFile: async (f: File): Promise<AssetRef> => {
        stored.push(f)
        return { sha256: 'a'.repeat(64) as AssetRef['sha256'], kind: f.name.endsWith('.glb') ? 'glb' : 'image', mime: f.type, size: f.size, name: f.name, sources: [] }
      },
    }
    const entry = await storeModel(prepared, assets, { scale: 2 })
    expect(stored.map((f) => f.name)).toEqual(['test-cube.glb', 'test-cube.thumb.webp'])
    expect(entry.size).toEqual([2, 2, 2])
    expect(entry.model.kind).toBe('glb')
    expect(entry.thumbnail).toMatchObject({ kind: 'image' })
    expect(entry.id).not.toBe(prepared.entry.id)
    const m = await measureGlb(new Uint8Array(await stored[0].arrayBuffer()))
    expect(m.max[1] - m.min[1]).toBeCloseTo(2, 2)
    expect(m.min[1]).toBeCloseTo(0, 2)
  })
})
