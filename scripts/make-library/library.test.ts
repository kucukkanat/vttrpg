/**
 * Every built-in catalogue entry must point at a real, unchanged, CC0 model that is believably
 * sized, within the triangle and byte budgets, carries a WebP thumbnail and loads in three.js.
 * Rebuild with `npm run library`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Box3, Mesh } from 'three'
import type { CatalogueEntry } from '@/core/catalogue'

const LIBRARY = resolve(__dirname, '../../public/library')
const catalogue = JSON.parse(readFileSync(resolve(LIBRARY, 'catalogue.json'), 'utf8')) as CatalogueEntry[]

const TRIANGLE_BUDGET = 5000
const MODEL_BYTES_MAX = 100 * 1024
const AVERAGE_BYTES_MAX = 100 * 1024
const LIBRARY_BYTES_MAX = 25 * 1024 * 1024
const CATEGORIES = ['furniture', 'container', 'light', 'nature', 'structure', 'decor', 'tableware', 'food', 'treasure', 'equipment', 'kit']

async function parseGlb(rel: string): Promise<GLTF> {
  const bytes = readFileSync(resolve(LIBRARY, rel))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  await MeshoptDecoder.ready
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  return new Promise((ok, err) => loader.parse(buffer, '', ok, err))
}

/** Width and height of a WebP from its header (VP8, VP8L or VP8X). */
function webpSize(b: Buffer): [number, number] {
  expect(b.toString('ascii', 0, 4)).toBe('RIFF')
  expect(b.toString('ascii', 8, 12)).toBe('WEBP')
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
}

describe('catalogue.json', () => {
  it('has a curated library of 150 to 250 props plus kit pieces', () => {
    const props = catalogue.filter((e) => !e.kit)
    expect(props.length).toBeGreaterThanOrEqual(150)
    expect(props.length).toBeLessThanOrEqual(250)
    expect(catalogue.filter((e) => e.kit === 'kaykit-dungeon').length).toBeGreaterThanOrEqual(20)
    expect(catalogue.filter((e) => e.kit === 'kenney-town').length).toBeGreaterThanOrEqual(20)
  })

  it('has unique ids and model paths', () => {
    expect(new Set(catalogue.map((e) => e.id)).size).toBe(catalogue.length)
    expect(new Set(catalogue.map((e) => e.model.sources[0])).size).toBe(catalogue.length)
  })

  it('stays within the byte budget', () => {
    let models = 0
    let thumbs = 0
    for (const e of catalogue) {
      models += e.model.size
      if (typeof e.thumbnail === 'string') thumbs += statSync(resolve(LIBRARY, e.thumbnail)).size
    }
    expect(models / catalogue.length).toBeLessThanOrEqual(AVERAGE_BYTES_MAX)
    expect(models + thumbs).toBeLessThanOrEqual(LIBRARY_BYTES_MAX)
  })

  it('is listed in index.json for the existing pickers', () => {
    const index = JSON.parse(readFileSync(resolve(LIBRARY, 'index.json'), 'utf8')) as Array<{ path: string; sha256: string }>
    const byPath = new Map(index.map((e) => [e.path, e.sha256]))
    for (const e of catalogue) expect(byPath.get(e.model.sources[0]!), e.id).toBe(e.model.sha256)
  })
})

describe.each(catalogue.map((e) => [e.id, e] as const))('%s', (_id, e) => {
  const rel = e.model.sources[0]!

  it('is a well-formed CC0 entry', () => {
    expect(e.origin).toBe('builtin')
    expect(e.id).toBe(`builtin:${rel}`)
    expect(e.title.trim().length).toBeGreaterThan(1)
    expect(CATEGORIES).toContain(e.category)
    expect(e.tags.length).toBeGreaterThan(0)
    for (const t of e.tags) expect(t).toBe(t.toLowerCase())
    if (e.kit) expect(e.category).toBe('kit')
    expect(e.licence.id).toBe('cc0')
    expect(e.licence.author).toBeTruthy()
    expect(e.licence.source).toBeTruthy()
    expect(e.licence.sourceUrl).toMatch(/^https:\/\//)
    expect(e.model.kind).toBe('glb')
    expect(e.model.mime).toBe('model/gltf-binary')
  })

  it('points at the exact bytes it names, within the budgets', () => {
    const file = resolve(LIBRARY, rel)
    expect(existsSync(file)).toBe(true)
    const bytes = readFileSync(file)
    expect(bytes.length).toBe(e.model.size)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(e.model.sha256)
    expect(e.model.name).toBe(rel.split('/').pop())
    expect(e.model.size).toBeLessThanOrEqual(MODEL_BYTES_MAX)
    expect(e.triangles).toBeGreaterThan(0)
    expect(e.triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET)
  })

  it('has a 256 px square WebP thumbnail', () => {
    expect(typeof e.thumbnail).toBe('string')
    const file = resolve(LIBRARY, e.thumbnail as string)
    expect(existsSync(file)).toBe(true)
    expect(webpSize(readFileSync(file))).toEqual([256, 256])
  })

  it('loads at a sane real-world size, matching its recorded bounds', async () => {
    const gltf = await parseGlb(rel)
    let meshes = 0
    gltf.scene.traverse((o) => { if (o instanceof Mesh) meshes++ })
    expect(meshes).toBeGreaterThan(0)
    const box = new Box3().setFromObject(gltf.scene, true)
    const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
    for (let i = 0; i < 3; i++) expect(Math.abs(size[i]! - e.size[i]!)).toBeLessThan(0.02)
    expect(Math.max(...e.size)).toBeGreaterThan(0.02)
    expect(Math.max(...e.size)).toBeLessThan(12)
    if (e.kit) return
    // Props stand on the floor with their pivot at the bottom centre (the hand-built starter
    // props are authored by eye and may hover or sink a few centimetres).
    expect(Math.abs(box.min.y)).toBeLessThan(rel.startsWith('props/') ? 0.05 : 0.02)
    if (!rel.startsWith('props/')) {
      expect(Math.abs(box.min.x + box.max.x) / 2).toBeLessThan(0.02)
      expect(Math.abs(box.min.z + box.max.z) / 2).toBeLessThan(0.02)
      expect(gltf.scene.userData.style).toBe('diorama')
      expect(gltf.scene.userData.kind).toBe('prop')
    }
  })
})
