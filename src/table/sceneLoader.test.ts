import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { interpretScene, kelvinToColor } from './sceneLoader'

async function parseGlb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((ok, err) => new GLTFLoader().parse(buffer, '', ok, err))
}

describe('interpretScene on the generated dev room', () => {
  it('applies the Blender convention', async () => {
    const gltf = await parseGlb(resolve(__dirname, '../../public/library/scenes/dev-room.glb'))
    const scene = interpretScene(gltf)
    expect(scene.colliders.map((c) => c.name).sort()).toEqual([
      'COL_WALL_east', 'COL_WALL_north', 'COL_WALL_south', 'COL_WALL_west', 'COL_floor', 'COL_pillar',
    ])
    for (const c of scene.colliders) expect(c.visible).toBe(false)
    // 5 boxes -> 4 segments each; the floor slab adds 4 thin sides.
    expect(scene.walls.length).toBe(24)
    expect(scene.lights).toHaveLength(2)
    expect(scene.lights.map((l) => l.flicker).sort()).toEqual([0.4, 0.6])
    // color_temp 2200 K gives a warm, red-dominant colour
    const c = scene.lights[0]!.object as import('three').PointLight
    expect(c.color.r).toBeGreaterThan(c.color.b)
    expect(scene.spawns.player).toBeDefined()
    expect(scene.spawns.player!.x).toBeCloseTo(-3.75)
    expect(scene.grid).toEqual({ type: 'square', cellSize: 1.5, origin: { x: -5.25, y: 0, z: -3.75 } })
    expect(scene.fogRegions.map((f) => f.name)).toEqual(['FOG_east'])
    expect(scene.fogRegions[0]!.visible).toBe(false)
    expect(scene.ambientAudio).toBe('library/audio/dungeon-drips.ogg')
    expect(scene.report.missing).toEqual([])
    expect(scene.report.found).toContain('GRID')
    expect(scene.floorY).toBe(0)
    expect(scene.bounds.min.x).toBeLessThan(-6)
    expect(scene.bounds.max.x).toBeGreaterThan(6)
  })
})

describe('kelvinToColor', () => {
  it('is warm at low and cool at high temperatures', () => {
    const warm = kelvinToColor(2000)
    const cool = kelvinToColor(10000)
    expect(warm.r).toBeGreaterThan(warm.b)
    expect(cool.b).toBeGreaterThan(cool.r)
    expect(kelvinToColor(6600).r).toBeCloseTo(1, 1)
  })
})
