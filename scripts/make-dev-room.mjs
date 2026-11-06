#!/usr/bin/env node
/**
 * Generates public/library/scenes/dev-room.glb: a small stone room that follows the Blender
 * naming convention (see public/library/scenes/README.md), used by the table dev story.
 *
 *   node scripts/make-dev-room.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Scene,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// GLTFExporter reads binary chunks through FileReader, which Node does not provide.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.({ target: this }) })
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`
        this.onloadend?.({ target: this })
      })
    }
  }
}

const ROOM_W = 12 // x, meters
const ROOM_D = 9 // z
const WALL_H = 2.2
const WALL_T = 0.25
const CELL = 1.5

const scene = new Scene()
scene.name = 'dev-room'
scene.userData = { ambient_audio: 'library/audio/dungeon-drips.ogg' }

const stone = new MeshStandardMaterial({ color: new Color('#6f6a63'), roughness: 0.95, metalness: 0 })
const floorMat = new MeshStandardMaterial({ color: new Color('#4b4740'), roughness: 1, metalness: 0 })
const trimMat = new MeshStandardMaterial({ color: new Color('#8a7b5a'), roughness: 0.8, metalness: 0 })

// Visible floor and walls (render geometry)
const floor = new Mesh(new PlaneGeometry(ROOM_W, ROOM_D), floorMat)
floor.name = 'floor'
floor.rotation.x = -Math.PI / 2
scene.add(floor)

function wall(name, w, d, x, z) {
  const m = new Mesh(new BoxGeometry(w, WALL_H, d), stone)
  m.name = name
  m.position.set(x, WALL_H / 2, z)
  return m
}
const walls = new Group()
walls.name = 'walls'
walls.add(
  wall('WALL_north', ROOM_W + WALL_T, WALL_T, 0, -ROOM_D / 2 - WALL_T / 2),
  wall('WALL_south', ROOM_W + WALL_T, WALL_T, 0, ROOM_D / 2 + WALL_T / 2),
  wall('WALL_west', WALL_T, ROOM_D, -ROOM_W / 2 - WALL_T / 2, 0),
  wall('WALL_east', WALL_T, ROOM_D, ROOM_W / 2 + WALL_T / 2, 0),
)
scene.add(walls)

// An interior partition so line-of-sight has something to hide behind.
const pillar = wall('pillar', 0.6, 3.0, 1.5, -0.75)
pillar.material = trimMat
scene.add(pillar)

// Colliders: duplicates of the wall boxes, named COL_*; hidden after load, used for LoS.
const colliders = new Group()
colliders.name = 'colliders'
for (const src of [...walls.children, pillar]) {
  const c = new Mesh(src.geometry.clone(), stone)
  c.name = `COL_${src.name}`
  c.position.copy(src.position)
  colliders.add(c)
}
const colFloor = new Mesh(new BoxGeometry(ROOM_W, 0.1, ROOM_D), stone)
colFloor.name = 'COL_floor'
colFloor.position.y = -0.05
colliders.add(colFloor)
scene.add(colliders)

// Lights: two warm torches with flicker.
function torch(name, x, z, flicker) {
  const holder = new Object3D()
  holder.name = name
  holder.position.set(x, 2.0, z)
  holder.userData = { flicker, color_temp: 2200 }
  const light = new PointLight(0xffffff, 60, 0, 2)
  light.name = `${name}_light`
  holder.add(light)
  return holder
}
scene.add(torch('LIGHT_torch_west', -4.5, -3.5, 0.6))
scene.add(torch('LIGHT_torch_east', 4.5, 3.0, 0.4))

// Spawn and grid
const spawn = new Object3D()
spawn.name = 'SPAWN_player'
spawn.position.set(-3.75, 0, 2.25)
scene.add(spawn)

const grid = new Object3D()
grid.name = 'GRID'
grid.position.set(-ROOM_W / 2 + CELL / 2, 0, -ROOM_D / 2 + CELL / 2)
grid.userData = { cell_size: CELL, type: 'square' }
scene.add(grid)

// Fog region covering the east half.
const fog = new Mesh(new BoxGeometry(ROOM_W / 2, 0.1, ROOM_D), stone)
fog.name = 'FOG_east'
fog.position.set(ROOM_W / 4, 0.05, 0)
scene.add(fog)

const exporter = new GLTFExporter()
const glb = await exporter.parseAsync(scene, { binary: true })
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/library/scenes/dev-room.glb')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(glb))
console.log(`wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} kB)`)
