/**
 * The kit manifests (public/library/kits/<kit>.json): every piece resolves to a catalogue entry,
 * the committed files are what the generator makes, and each piece's footprint, walls and join
 * arms agree with its geometry once moved into the canonical frame. Rebuild with `npm run library`
 * (or `node scripts/make-library/kits.mjs`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Box3 } from 'three'
import type { CatalogueEntry } from '@/core/catalogue'
import { BUILTIN_KITS, KIT_CELL, type KitManifest } from '@/core/kits'
import { DIRS, isAreaSlot, isEdgeSlot, isVertexSlot } from '@/core/kitGeometry'
import { pieceGeometry } from '@/table/kits/kitGeometry'
// @ts-expect-error -- plain JS build script without types
import { buildManifests } from './kits.mjs'

const LIBRARY = resolve(__dirname, '../../public/library')
const catalogue = JSON.parse(readFileSync(resolve(LIBRARY, 'catalogue.json'), 'utf8')) as CatalogueEntry[]
const manifests = Object.fromEntries(BUILTIN_KITS.map((id) => [id, JSON.parse(readFileSync(resolve(LIBRARY, 'kits', `${id}.json`), 'utf8')) as KitManifest]))

async function parseGlb(rel: string): Promise<GLTF> {
  const buf = readFileSync(resolve(LIBRARY, rel))
  const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  await MeshoptDecoder.ready
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  return new Promise((ok, err) => loader.parse(buffer, '', ok, err))
}

describe('kit manifests', () => {
  it('are what the generator makes from the catalogue', () => {
    const built = buildManifests(catalogue, manifests) as Record<string, KitManifest>
    for (const id of BUILTIN_KITS) expect(JSON.parse(JSON.stringify(built[id]))).toEqual(manifests[id])
  })

  for (const id of BUILTIN_KITS) {
    describe(id, () => {
      const m = manifests[id]!
      it('has every catalogue piece of the kit, once, each resolving to its entry', () => {
        const entries = catalogue.filter((e) => e.kit === id)
        expect(m.pieces).toHaveLength(entries.length)
        expect(new Set(m.pieces.map((p) => p.id)).size).toBe(m.pieces.length)
        for (const p of m.pieces) {
          const e = catalogue.find((c) => c.id === p.catalogue)
          expect(e, p.id).toBeDefined()
          expect(e!.kit).toBe(id)
          expect(e!.category).toBe('kit')
        }
      })
      it('names real pieces as its defaults, and the plain walls fit together', () => {
        for (const [k, v] of Object.entries(m.defaults)) expect(m.pieces.some((p) => p.id === v), `${k} = ${v}`).toBe(true)
        const piece = (pid?: string) => m.pieces.find((p) => p.id === pid)
        expect(piece(m.defaults.wall)!.slot).toBe('wall')
        expect(piece(m.defaults.door)!.slot).toBe('door')
        expect(piece(m.defaults.window)!.slot).toBe('window')
        expect(piece(m.defaults.stair)!.slot).toBe('stair')
        for (const j of [m.defaults.corner, m.defaults.tee, m.defaults.cross]) if (j) expect(piece(j)!.arms?.length).toBeGreaterThan(1)
        expect(m.module).toBeGreaterThanOrEqual(1)
      })
      it('has sane footprints, heights, walls and arms', () => {
        for (const p of m.pieces) {
          const [w, d] = p.footprint
          if (isAreaSlot(p.slot)) {
            expect(Number.isInteger(w) && Number.isInteger(d) && w >= 1 && d >= 1 && w <= 3 && d <= 3, p.id).toBe(true)
          } else if (isEdgeSlot(p.slot)) {
            expect([1, 2], p.id).toContain(w)
            expect(d).toBe(0)
          } else {
            expect(isVertexSlot(p.slot)).toBe(true)
            expect([w, d]).toEqual([0, 0])
          }
          expect([0, 1], p.id).toContain(p.height)
          expect([1, 2, 4]).toContain(p.symmetry)
          for (const s of p.los) for (const v of [...s.a, ...s.b]) expect(Math.abs(v), p.id).toBeLessThanOrEqual(2)
          for (const a of p.arms ?? []) { expect(DIRS).toContain(a.dir); expect(a.length).toBeGreaterThanOrEqual(1) }
          if (p.openAs) expect(m.pieces.some((q) => q.id === p.openAs && q.slot === 'door'), p.id).toBe(true)
        }
      })
      it('matches its geometry in the canonical frame', async () => {
        const tol = 0.45
        for (const p of m.pieces) {
          const gltf = await parseGlb(p.catalogue.replace(/^builtin:/, ''))
          const geo = pieceGeometry(gltf.scene, p)!
          const box = new Box3().setFromBufferAttribute(geo.getAttribute('position') as never)
          const c = KIT_CELL
          if (isAreaSlot(p.slot)) {
            // Inside its footprint (roofs and railings may overhang a little); floors and stairs fill it.
            const hx = (p.footprint[0] * c) / 2, hz = (p.footprint[1] * c) / 2, over = tol + 0.3
            expect(box.min.x, `${p.id} min x`).toBeGreaterThan(-hx - over)
            expect(box.max.x, `${p.id} max x`).toBeLessThan(hx + over)
            expect(box.min.z, `${p.id} min z`).toBeGreaterThan(-hz - over)
            expect(box.max.z, `${p.id} max z`).toBeLessThan(hz + over)
            if (p.slot !== 'roof') {
              expect(box.max.x - box.min.x, `${p.id} width`).toBeGreaterThan(2 * hx - 0.6)
              expect(box.max.z - box.min.z, `${p.id} depth`).toBeGreaterThan(2 * hz - 0.6)
            }
          } else if (isEdgeSlot(p.slot) && p.los.length) {
            // Runs along x over its length, close to the line.
            expect(Math.abs(box.max.x - box.min.x - p.footprint[0] * c), `${p.id} length`).toBeLessThan(tol)
            expect(Math.max(Math.abs(box.min.z), Math.abs(box.max.z)), `${p.id} off the line`).toBeLessThan(0.7)
          } else if (p.arms?.length) {
            // Reaches out along each arm.
            for (const a of p.arms) {
              const reach = { E: box.max.x, W: -box.min.x, S: box.max.z, N: -box.min.z }[a.dir]
              expect(Math.abs(reach - a.length * c), `${p.id} arm ${a.dir}`).toBeLessThan(tol)
            }
          }
          if (p.slot === 'wall' || p.slot === 'door' || p.slot === 'window') expect(box.max.y).toBeGreaterThan(1.4)
        }
      }, 30000)
    })
  }
})
