#!/usr/bin/env node
/**
 * Generates public/library/scenes/dev-room.glb: a small stone room that follows the Blender
 * naming convention (see public/library/scenes/README.md), used by the table dev story.
 *
 *   node scripts/make-dev-room.mjs      (or `npm run scenes` for every generated scene)
 */
import { CELL, block, fog, floor, floorCollider, grid, group, light, mat, newScene, spawn, wall, writeGlb } from './make-scenes/lib.mjs'

const ROOM_W = 12 // x, meters
const ROOM_D = 9 // z
const WALL_H = 3
const WALL_T = 0.3

const stone = mat('#6f6a63', { roughness: 0.95 })
const floorMat = mat('#4b4740', { roughness: 1 })
const trimMat = mat('#8a7b5a', { roughness: 0.8 })

const scene = newScene('dev-room', { ambient_audio: 'library/audio/dungeon-drips.ogg' })

// Visible floor and walls (render geometry)
scene.add(floor('floor', ROOM_W, ROOM_D, floorMat))

// Walls (WALL_* visible + COL_wall_* colliders) and an interior partition so line-of-sight has
// something to hide behind.
const walls = group('walls')
const colliders = group('colliders')
for (const [v, c] of [
  wall('north', [ROOM_W + WALL_T, WALL_H, WALL_T], [0, -ROOM_D / 2 - WALL_T / 2], stone),
  wall('south', [ROOM_W + WALL_T, WALL_H, WALL_T], [0, ROOM_D / 2 + WALL_T / 2], stone),
  wall('west', [WALL_T, WALL_H, ROOM_D], [-ROOM_W / 2 - WALL_T / 2, 0], stone),
  wall('east', [WALL_T, WALL_H, ROOM_D], [ROOM_W / 2 + WALL_T / 2, 0], stone),
]) { walls.add(v); colliders.add(c) }
scene.add(walls)
scene.add(block('pillar', [0.6, WALL_H, 3.0], [1.5, -0.75], trimMat))
colliders.add(block('COL_pillar', [0.6, WALL_H, 3.0], [1.5, -0.75], stone))
colliders.add(floorCollider(ROOM_W, ROOM_D))
scene.add(colliders)

// Lights: two warm torches with flicker.
scene.add(light('LIGHT_torch_west', [-4.5, 2.0, -3.5], { flicker: 0.6, color_temp: 2200, intensity: 60 }))
scene.add(light('LIGHT_torch_east', [4.5, 2.0, 3.0], { flicker: 0.4, color_temp: 2200, intensity: 60 }))

// Spawn and grid
scene.add(spawn('SPAWN_player', [-3.75, 2.25]))
scene.add(grid([-ROOM_W / 2 + CELL / 2, -ROOM_D / 2 + CELL / 2], CELL, 'square'))

// Fog region covering the east half.
scene.add(fog('FOG_east', [ROOM_W / 2, ROOM_D], [ROOM_W / 4, 0]))


await writeGlb(scene, 'dev-room.glb')
