/**
 * Every generated prop and mini must load, stand on the floor, fit one grid cell without any
 * correction and stay small. Regenerate with `npm run props`.
 */
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Box3, Mesh, PointLight } from 'three'
import { fitObjectToCell, horizontalExtent, PROP_FIT, TOKEN_FIT } from '@/table/fitScale'
import { expectDiorama } from '../make-scenes/diorama'

const LIBRARY = resolve(__dirname, '../../public/library')
const CELL = 1.5

async function parseGlb(file: string): Promise<GLTF> {
  const bytes = readFileSync(resolve(LIBRARY, file))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((ok, err) => new GLTFLoader().parse(buffer, '', ok, err))
}

const PROPS = [
  'barrel', 'crate', 'table', 'chair', 'chest', 'torch-stand', 'bed', 'bookshelf', 'campfire', 'rock', 'cauldron',
  'weapon-rack', 'well',
].map((n) => `props/${n}.glb`)
const MINIS = ['mouse-adventurer', 'rat', 'knight', 'goblin', 'skeleton', 'wizard'].map((n) => `minis/${n}.glb`)
/** Models with a light source: their flame, embers, eyes or orb stay emissive. */
const EMISSIVE = new Set(['props/table.glb', 'props/torch-stand.glb', 'props/campfire.glb', 'props/cauldron.glb', 'minis/rat.glb', 'minis/wizard.glb'])

describe.each([...PROPS, ...MINIS])('%s', (file) => {
  it('stays under 100 kB', () => {
    expect(statSync(resolve(LIBRARY, file)).size).toBeLessThan(100 * 1024)
  })

  it('has visible meshes, stands on the floor and fits one cell as authored', async () => {
    const gltf = await parseGlb(file)
    let meshes = 0
    gltf.scene.traverse((o) => { if (o instanceof Mesh && o.visible) meshes++ })
    expect(meshes).toBeGreaterThan(0)
    const box = new Box3().setFromObject(gltf.scene, true)
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02)
    expect(box.max.y).toBeGreaterThan(0.4)
    const extent = horizontalExtent(gltf.scene)
    expect(extent).toBeGreaterThan(0.4)
    expect(extent).toBeLessThanOrEqual(CELL + 1e-6)
    // Props drop in at their authored size; minis read at one cell with at most a modest upscale.
    expect(fitObjectToCell(gltf.scene, CELL, PROP_FIT)).toBe(1)
    const tokenFit = fitObjectToCell(gltf.scene, CELL, TOKEN_FIT)
    expect(tokenFit).toBeGreaterThanOrEqual(1)
    expect(tokenFit).toBeLessThanOrEqual(file.startsWith('minis/') ? 1.5 : 4)
    expect(gltf.scene.userData.kind).toBe(file.startsWith('minis/') ? 'mini' : 'prop')
  })

  it('carries the baked diorama look in a single shared-material mesh', async () => {
    const gltf = await parseGlb(file)
    const { baked, emissive } = expectDiorama(gltf.scene)
    // Baked parts are merged into one mesh per model; light sources stay separate.
    expect(baked).toBe(1)
    if (EMISSIVE.has(file)) expect(emissive).toBeGreaterThan(0)
    else expect(emissive).toBe(0)
  })
})

describe.each(MINIS)('%s proportions', (file) => {
  it('stands 1.1 to 1.8 m tall and faces +Z', async () => {
    const gltf = await parseGlb(file)
    const box = new Box3().setFromObject(gltf.scene, true)
    expect(box.max.y).toBeGreaterThanOrEqual(1.1)
    expect(box.max.y).toBeLessThanOrEqual(1.8)
    // Faces +Z: snouts, weapons and shields reach well forward of the centre.
    expect(box.max.z).toBeGreaterThan(0.2)
  })
})

describe('lit props', () => {
  it.each(['props/torch-stand.glb', 'props/campfire.glb'])('%s carries a flickering LIGHT_ node', async (file) => {
    const gltf = await parseGlb(file)
    const holders: string[] = []
    gltf.scene.traverse((o) => { if (o instanceof PointLight && o.parent?.name.startsWith('LIGHT_')) holders.push(o.parent.name) })
    expect(holders).toHaveLength(1)
    const holder = gltf.scene.getObjectByName(holders[0]!)!
    expect(holder.userData.flicker).toBeGreaterThan(0)
    expect(holder.userData.color_temp).toBeLessThan(2500)
  })
})
