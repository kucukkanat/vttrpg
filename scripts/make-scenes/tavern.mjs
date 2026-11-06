#!/usr/bin/env node
/**
 * public/library/scenes/tavern.glb: a 12 x 9 m common room. Bar counter along the east wall,
 * four tables with benches, a fireplace in the north wall (LIGHT_fire), three wall sconces,
 * a door in the south wall. Square grid, cell 1.5 m, cell (0,0) is the north-west corner cell.
 *
 * Spawn points (hardcoded in src/ui/templates.ts, keep in sync):
 *   SPAWN_player   (-3.75, 0, 2.25)   a cell inside the door
 *   SPAWN_barkeep  ( 5.25, 0, -0.75)  behind the counter
 */
import {
  CELL, block, box, collider, cylinder, fog, floor, floorCollider, grid, group, light, mat, newScene,
  spawn, torch, tableWithBenches, wall, writeGlb,
} from './lib.mjs'

const W = 12 // x
const D = 9 // z
const H = 3.2
const T = 0.3

const plaster = mat('#b8a98a')
const timber = mat('#4a3620')
const planks = mat('#6b4e2e', { roughness: 1 })
const stone = mat('#6f6a63')
const counterMat = mat('#5a3f24')

const scene = newScene('tavern', { ambient_preset: 'tavern' })

// Floor and ceiling beams
scene.add(floor('floor', W, D, planks))
scene.add(floorCollider(W, D))
const beams = group('beams')
for (const x of [-4, 0, 4]) beams.add(box('beam', [0.25, 0.25, D], [x, H - 0.125, 0], timber))
scene.add(beams)

// Walls (visible + COL_). The south wall has a 1.5 m door gap centred at x = -3.
const walls = group('walls')
const cols = group('colliders')
const add = ([v, c]) => { walls.add(v); cols.add(c) }
add(wall('north', [W + 2 * T, H, T], [0, -D / 2 - T / 2], plaster))
add(wall('west', [T, H, D], [-W / 2 - T / 2, 0], plaster))
add(wall('east', [T, H, D], [W / 2 + T / 2, 0], plaster))
add(wall('south_west', [2.4, H, T], [-W / 2 - T + 1.2, D / 2 + T / 2], plaster))
add(wall('south_east', [8.4, H, T], [-2.25 + 4.2, D / 2 + T / 2], plaster))
// Lintel above the door
walls.add(box('WALL_door_lintel', [1.5, H - 2.2, T], [-3, 2.2 + (H - 2.2) / 2, D / 2 + T / 2], plaster))
// Door leaf, swung open inwards
const door = box('door', [1.4, 2.1, 0.08], [0, 1.05, 0], timber)
const hinge = group('door_hinge', door)
hinge.position.set(-3.75, 0, D / 2)
hinge.rotation.y = Math.PI / 2.6
door.position.set(0.7, 1.05, 0)
walls.add(hinge)
scene.add(walls, cols)

// Fireplace in the north wall, centred at x = 0
const hearth = group('fireplace')
hearth.add(block('hearth_left', [0.4, 2.4, 0.7], [-1.0, -D / 2 + 0.35], stone))
hearth.add(block('hearth_right', [0.4, 2.4, 0.7], [1.0, -D / 2 + 0.35], stone))
hearth.add(box('hearth_lintel', [2.4, 0.5, 0.7], [0, 2.15, -D / 2 + 0.35], stone))
hearth.add(block('hearth_floor', [1.6, 0.12, 0.7], [0, -D / 2 + 0.35], mat('#3c3833')))
hearth.add(box('chimney', [2.4, H - 2.4, 0.7], [0, 2.4 + (H - 2.4) / 2, -D / 2 + 0.35], stone))
for (const a of [0.4, 1.9]) {
  const log = cylinder('firewood', 0.08, 0.08, 0.9, [0, -D / 2 + 0.4], mat('#3d2a17'), 6, 0.2)
  log.rotation.set(Math.PI / 2, 0, a)
  hearth.add(log)
}
hearth.add(cylinder('fire_flame', 0.0, 0.28, 0.7, [0, -D / 2 + 0.4], mat('#ffb347', { emissive: '#ff6a00', emissiveIntensity: 2.5 }), 6, 0.5))
scene.add(hearth)
scene.add(collider('fireplace', [2.4, 2.4, 0.7], [0, -D / 2 + 0.35]))
scene.add(light('LIGHT_fire', [0, 0.9, -D / 2 + 0.6], { flicker: 0.8, color_temp: 1800, intensity: 90 }))

// Bar counter along the east wall with shelves behind it
const bar = group('bar')
bar.add(block('counter', [0.6, 1.05, 5.2], [3.9, -0.5], counterMat))
bar.add(box('counter_top', [0.8, 0.08, 5.4], [3.9, 1.07, -0.5], mat('#8a6a3e')))
bar.add(block('shelf_back', [0.3, 2.2, 4.0], [W / 2 - 0.15, -0.5], timber))
for (const y of [0.9, 1.5]) bar.add(box('shelf', [0.35, 0.05, 4.0], [W / 2 - 0.35, y, -0.5], mat('#8a6a3e')))
// Bottles and mugs on the shelves
let i = 0
for (const y of [0.95, 1.55]) for (const z of [-2.2, -1.5, -0.8, 0.0, 0.7, 1.3]) {
  const tint = ['#4d7a3a', '#7a3a3a', '#3a5a7a', '#c9a35a'][i++ % 4]
  bar.add(cylinder('bottle', 0.05, 0.06, 0.28, [W / 2 - 0.35, z], mat(tint), 6, y + 0.14))
}
scene.add(bar)
scene.add(collider('counter', [0.8, 1.1, 5.4], [3.9, -0.5]))
scene.add(collider('shelf_back', [0.3, 2.2, 4.0], [W / 2 - 0.15, -0.5]))

// Barrels in the north-east corner
for (const [x, z] of [[5.1, -3.8], [4.3, -3.9], [5.2, -3.0]]) {
  scene.add(cylinder('barrel', 0.38, 0.42, 0.9, [x, z], mat('#5a4328'), 10))
}
scene.add(collider('barrels', [1.7, 0.9, 1.6], [4.8, -3.5]))

// Tables with benches
const tables = group('tables')
for (const [name, x, z] of [
  ['table_1', -3.0, -2.25],
  ['table_2', -3.0, 1.0],
  ['table_3', 0.75, -1.5],
  ['table_4', 0.75, 2.0],
]) {
  const [g, c] = tableWithBenches(name, [x, z])
  tables.add(g)
  scene.add(c)
}
scene.add(tables)

// Wall sconces
for (const [name, pos] of [
  ['LIGHT_sconce_west', [-W / 2 + 0.15, 2.0, -1.5]],
  ['LIGHT_sconce_north', [3.5, 2.0, -D / 2 + 0.15]],
  ['LIGHT_sconce_south', [3.0, 2.0, D / 2 - 0.15]],
]) {
  const [prop, l] = torch(name, pos, { flicker: 0.45, intensity: 40 })
  scene.add(prop, l)
}

// Spawns and grid. Cell (0,0) is the north-west corner cell; cells run +x, +z.
scene.add(spawn('SPAWN_player', [-3.75, 2.25]))
scene.add(spawn('SPAWN_barkeep', [5.25, -0.75]))
scene.add(grid([-W / 2 + CELL / 2, -D / 2 + CELL / 2], CELL, 'square'))

// A back room behind the bar (north-east) stays hidden until revealed.
scene.add(fog('FOG_cellar_stairs', [1.5, 1.5], [5.25, 3.75]))

await writeGlb(scene, 'tavern.glb')
