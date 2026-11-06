#!/usr/bin/env node
/**
 * public/library/scenes/dungeon.glb: an entrance corridor, two side rooms off a cross passage,
 * and a pillar hall at the far end. Built from a cell map (1 cell = 1.5 m): every edge between
 * floor and rock becomes a COL_ wall run, each room gets a FOG_ region, two torches light the way.
 *
 * Spawn points (hardcoded in src/ui/templates.ts, keep in sync):
 *   SPAWN_player       ( 0,    0,  8.25)  the entrance, south end of the corridor
 *   SPAWN_player_2     ( 0,    0,  6.75)  one cell north
 *   SPAWN_player_3     ( 0,    0,  5.25)  two cells north
 *   SPAWN_enemy_rat    (-4.5,  0,  2.25)  west room
 *   SPAWN_enemy_brute  ( 0,    0, -6.75)  pillar hall
 */
import {
  CELL, block, box, collider, cylinder, fog, floorCollider, grid, group, mat, newScene, paint, spawn, torch,
  vertexMaterial, writeGlb,
} from './lib.mjs'
import { CylinderGeometry, Mesh, PlaneGeometry } from 'three'

// '#' floor, '.' solid rock. Columns are x (west to east), rows are z (north to south).
const MAP = [
  '.#######.', // 0  pillar hall
  '.#######.', // 1
  '.#######.', // 2
  '.#######.', // 3
  '....#....', // 4  corridor
  '....#....', // 5
  '###.#.###', // 6  rooms
  '#########', // 7  cross passage
  '###.#.###', // 8
  '....#....', // 9  entrance corridor
  '....#....', // 10
  '....#....', // 11 entrance
]
const COLS = MAP[0].length
const ROWS = MAP.length
const H = 3.0
const T = 0.3
const cx = (i) => (i - (COLS - 1) / 2) * CELL // col 4 -> x 0
const cz = (j) => (j - (ROWS - 1) / 2) * CELL // row 5.5 -> z 0
const isFloor = (i, j) => i >= 0 && j >= 0 && i < COLS && j < ROWS && MAP[j][i] === '#'

const rock = mat('#5b5650')
const flagstone = mat('#444039', { roughness: 1 })

const scene = newScene('dungeon', { ambient_preset: 'cave' })

// Floor: one strip per horizontal run of floor cells.
const floors = group('floor')
for (let j = 0; j < ROWS; j++) {
  let i = 0
  while (i < COLS) {
    if (!isFloor(i, j)) { i++; continue }
    let k = i
    while (isFloor(k + 1, j)) k++
    const n = k - i + 1
    const m = new Mesh(new PlaneGeometry(n * CELL, CELL), flagstone)
    m.name = 'floor_strip'
    m.rotation.x = -Math.PI / 2
    m.position.set((cx(i) + cx(k)) / 2, 0, cz(j))
    floors.add(m)
    i = k + 1
  }
}
scene.add(floors)
scene.add(floorCollider(COLS * CELL, ROWS * CELL))

// Walls: runs of edges between floor and rock, merged into one box per run.
const walls = group('walls')
const cols = group('colliders')
function addWall(name, w, d, x, z) {
  walls.add(block(name, [w, H, d], [x, z], rock))
  cols.add(block(`COL_${name}`, [w, H, d], [x, z], rock))
}
let n = 0
// Horizontal edges (between row j-1 and row j), merged along x.
for (let j = 0; j <= ROWS; j++) {
  let i = 0
  while (i < COLS) {
    const edge = isFloor(i, j - 1) !== isFloor(i, j)
    if (!edge) { i++; continue }
    let k = i
    while (k + 1 < COLS && isFloor(k + 1, j - 1) !== isFloor(k + 1, j)) k++
    const x0 = cx(i) - CELL / 2 - T / 2
    const x1 = cx(k) + CELL / 2 + T / 2
    addWall(`wall_${n++}`, x1 - x0, T, (x0 + x1) / 2, cz(j) - CELL / 2)
    i = k + 1
  }
}
// Vertical edges (between col i-1 and col i), merged along z.
for (let i = 0; i <= COLS; i++) {
  let j = 0
  while (j < ROWS) {
    const edge = isFloor(i - 1, j) !== isFloor(i, j)
    if (!edge) { j++; continue }
    let k = j
    while (k + 1 < ROWS && isFloor(i - 1, k + 1) !== isFloor(i, k + 1)) k++
    const z0 = cz(j) - CELL / 2 - T / 2
    const z1 = cz(k) + CELL / 2 + T / 2
    addWall(`wall_${n++}`, T, z1 - z0, cx(i) - CELL / 2, (z0 + z1) / 2)
    j = k + 1
  }
}
scene.add(walls, cols)

// Pillars in the hall (cells stay walkable around them).
const pillars = group('pillars')
for (const [i, j] of [[2, 1], [6, 1], [2, 2], [6, 2]]) {
  const p = new Mesh(paint(new CylinderGeometry(0.28, 0.34, H, 8), '#6a655e', '#8c877f'), vertexMaterial())
  p.name = 'pillar'
  p.position.set(cx(i), H / 2, cz(j))
  pillars.add(p)
  scene.add(collider(`pillar_${i}_${j}`, [0.7, H, 0.7], [cx(i), cz(j)]))
}
scene.add(pillars)

// Dressing: an altar in the hall, a chest in the east room, rubble in the west room, a door at the entrance.
scene.add(block('altar', [1.6, 0.9, 0.8], [cx(4), cz(0) + 0.1], mat('#3a3630')))
scene.add(collider('altar', [1.6, 0.9, 0.8], [cx(4), cz(0) + 0.1]))
scene.add(block('chest', [0.7, 0.5, 0.45], [cx(7), cz(6)], mat('#6b4a2e')))
scene.add(box('chest_lid', [0.72, 0.12, 0.47], [cx(7), 0.56, cz(6)], mat('#8a6a3e')))
for (const [dx, dz, r] of [[-0.4, 0.3, 0.25], [0.2, -0.4, 0.2], [0.5, 0.4, 0.18]]) {
  const rubble = new Mesh(paint(new CylinderGeometry(r * 0.7, r, r * 0.8, 6), '#4a4640', '#75706a'), vertexMaterial())
  rubble.name = 'rubble'
  rubble.position.set(cx(1) + dx, r * 0.4, cz(8) + dz)
  scene.add(rubble)
}
scene.add(box('entrance_door', [CELL - 0.1, 2.3, 0.1], [cx(4), 1.15, cz(11) + CELL / 2 - 0.2], mat('#3d2a17')))

// Two torches: one over the entrance corridor, one in the hall.
for (const [name, pos] of [
  ['LIGHT_torch_entrance', [cx(4) - CELL / 2 + 0.12, 2.0, cz(10)]],
  ['LIGHT_torch_hall', [cx(4), 2.1, cz(0) - CELL / 2 + 0.12]],
]) {
  const [prop, l] = torch(name, pos, { flicker: 0.6, intensity: 55 })
  scene.add(prop, l)
}

// Fog over the rooms and the hall: they start hidden.
scene.add(fog('FOG_room_west', [3 * CELL, 3 * CELL], [cx(1), cz(7)]))
scene.add(fog('FOG_room_east', [3 * CELL, 3 * CELL], [cx(7), cz(7)]))
scene.add(fog('FOG_hall', [7 * CELL, 4 * CELL], [cx(4), (cz(0) + cz(3)) / 2]))

// Spawns and grid (cell (0,0) is the north-west cell of the map).
scene.add(spawn('SPAWN_player', [cx(4), cz(11)]))
scene.add(spawn('SPAWN_player_2', [cx(4), cz(10)]))
scene.add(spawn('SPAWN_player_3', [cx(4), cz(9)]))
scene.add(spawn('SPAWN_enemy_rat', [cx(1), cz(7)]))
scene.add(spawn('SPAWN_enemy_brute', [cx(4), cz(1)]))
scene.add(grid([cx(0), cz(0)], CELL, 'square'))

await writeGlb(scene, 'dungeon.glb')
