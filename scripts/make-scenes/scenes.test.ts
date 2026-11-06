/**
 * Every generated scene must load through the table's scene loader and follow the naming
 * convention: colliders, lights, spawns, grid, size budget. Regenerate with `npm run scenes`.
 */
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Box3, Mesh, type PointLight } from 'three'
import { interpretScene } from '@/table/sceneLoader'

const SCENES = resolve(__dirname, '../../public/library/scenes')

async function parseGlb(file: string): Promise<GLTF> {
  const bytes = readFileSync(resolve(SCENES, file))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((ok, err) => new GLTFLoader().parse(buffer, '', ok, err))
}

const files = ['tavern.glb', 'dungeon.glb', 'forest.glb', 'dev-room.glb']

describe.each(files)('%s', (file) => {
  it('stays under 500 kB', () => {
    expect(statSync(resolve(SCENES, file)).size).toBeLessThan(500 * 1024)
  })

  it('loads with colliders, lights, SPAWN_player and GRID', async () => {
    const scene = interpretScene(await parseGlb(file))
    expect(scene.colliders.length).toBeGreaterThan(0)
    for (const c of scene.colliders) {
      expect(c.name.startsWith('COL_')).toBe(true)
      expect(c.visible).toBe(false)
    }
    expect(scene.walls.length).toBeGreaterThan(0)
    expect(scene.lights.length).toBeGreaterThan(0)
    expect(scene.spawns.player).toBeDefined()
    expect(scene.spawns.player!.y).toBe(0)
    expect(scene.grid).not.toBeNull()
    expect(scene.grid!.cellSize).toBe(1.5)
    expect(scene.floorY).toBe(0)
    // Only the ambient track may be reported missing (the generated scenes name a preset instead).
    expect(scene.report.missing.filter((m) => !m.startsWith('ambient_audio'))).toEqual([])
    expect(scene.report.warnings.filter((w) => !w.startsWith('no FOG_'))).toEqual([])
  })

  it('names visible walls WALL_* and keeps them at most 0.3 m thick', async () => {
    const gltf = await parseGlb(file)
    const walls: Mesh[] = []
    gltf.scene.traverse((o) => { if (o instanceof Mesh && /^wall_/i.test(o.name)) walls.push(o) })
    if (file === 'forest.glb') { expect(walls).toHaveLength(0); return }
    expect(walls.length).toBeGreaterThan(0)
    for (const w of walls) {
      const box = new Box3().setFromObject(w)
      const thickness = Math.min(box.max.x - box.min.x, box.max.z - box.min.z)
      expect(thickness, w.name).toBeLessThanOrEqual(0.3 + 1e-6)
    }
    // No visible mesh keeps the old lowercase wall_ names without the prefix.
    gltf.scene.traverse((o) => { if (o.name.startsWith('wall_')) throw new Error(`unprefixed wall ${o.name}`) })
  })
})

describe('tavern.glb', () => {
  it('has the fireplace, three sconces, bar, tables and both spawns', async () => {
    const gltf = await parseGlb('tavern.glb')
    const scene = interpretScene(gltf)
    const lightNames = scene.lights.map((l) => l.object.parent!.name).sort()
    expect(lightNames).toEqual(['LIGHT_fire', 'LIGHT_sconce_north', 'LIGHT_sconce_south', 'LIGHT_sconce_west'])
    const fire = scene.lights.find((l) => l.object.parent!.name === 'LIGHT_fire')!
    expect(fire.flicker).toBe(0.8)
    const c = fire.object as PointLight
    expect(c.color.r).toBeGreaterThan(c.color.b)
    expect(scene.spawns.player).toEqual({ x: -3.75, y: 0, z: 2.25 })
    expect(scene.spawns.barkeep).toEqual({ x: 5.25, y: 0, z: -0.75 })
    expect(scene.grid).toEqual({ type: 'square', cellSize: 1.5, origin: { x: -5.25, y: 0, z: -3.75 } })
    const names = new Set<string>()
    gltf.scene.traverse((o) => names.add(o.name))
    expect(names).toContain('counter')
    for (const t of ['table_1', 'table_2', 'table_3', 'table_4']) {
      expect(names).toContain(t)
      expect(names).toContain(`COL_${t}`)
    }
    expect(names).toContain('door')
    expect(names).toContain('COL_fireplace')
    expect(gltf.scene.userData.ambient_preset).toBe('tavern')
    // 12 x 9 m room
    expect(scene.bounds.max.x - scene.bounds.min.x).toBeCloseTo(12.6, 1)
    expect(scene.bounds.max.z - scene.bounds.min.z).toBeCloseTo(9.6, 1)
  })
})

describe('dungeon.glb', () => {
  it('has fog over the rooms, two torches and enemy spawns', async () => {
    const gltf = await parseGlb('dungeon.glb')
    const scene = interpretScene(gltf)
    expect(scene.fogRegions.map((f) => f.name).sort()).toEqual(['FOG_hall', 'FOG_room_east', 'FOG_room_west'])
    expect(scene.lights.map((l) => l.object.parent!.name).sort()).toEqual(['LIGHT_torch_entrance', 'LIGHT_torch_hall'])
    expect(scene.spawns.player).toEqual({ x: 0, y: 0, z: 8.25 })
    expect(scene.spawns.player_2).toEqual({ x: 0, y: 0, z: 6.75 })
    expect(scene.spawns.player_3).toEqual({ x: 0, y: 0, z: 5.25 })
    expect(scene.spawns.enemy_rat).toEqual({ x: -4.5, y: 0, z: 2.25 })
    expect(scene.spawns.enemy_brute).toEqual({ x: 0, y: 0, z: -6.75 })
    expect(scene.grid).toEqual({ type: 'square', cellSize: 1.5, origin: { x: -6, y: 0, z: -8.25 } })
    expect(scene.colliders.filter((c) => c.name.startsWith('COL_wall_')).length).toBeGreaterThan(10)
    expect(scene.colliders.filter((c) => c.name.startsWith('COL_pillar_'))).toHaveLength(4)
    expect(gltf.scene.userData.ambient_preset).toBe('cave')
  })
})

describe('forest.glb', () => {
  it('has a hex grid, a campfire light, trees as colliders and two player spawns', async () => {
    const gltf = await parseGlb('forest.glb')
    const scene = interpretScene(gltf)
    expect(scene.grid).toEqual({ type: 'hex', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } })
    expect(scene.lights.map((l) => l.object.parent!.name)).toEqual(['LIGHT_campfire'])
    expect(scene.lights[0]!.flicker).toBe(0.7)
    expect(scene.spawns.player!.x).toBeCloseTo(0.75)
    expect(scene.spawns.player!.z).toBeCloseTo(1.299, 3)
    expect(scene.spawns.player_2!.x).toBeCloseTo(-0.75)
    expect(scene.spawns.player_2!.z).toBeCloseTo(1.299, 3)
    const trunks = scene.colliders.filter((c) => c.name.startsWith('COL_tree_'))
    expect(trunks.length).toBeGreaterThanOrEqual(20)
    // Trunks are scaled shared geometry; wall extraction must see them in world space.
    expect(scene.walls.length).toBeGreaterThan(trunks.length)
    expect(scene.colliders.filter((c) => c.name.startsWith('COL_boulder_'))).toHaveLength(4)
    expect(scene.bounds.max.x - scene.bounds.min.x).toBeGreaterThan(20)
    expect(gltf.scene.userData.ambient_preset).toBe('forest')
  })
})
