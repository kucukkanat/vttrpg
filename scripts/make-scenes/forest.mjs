#!/usr/bin/env node
/**
 * public/library/scenes/forest.glb: a ~20 x 20 m clearing ringed by low-poly trees (vertex
 * colours), a campfire in the middle, a dirt path from the south edge, boulders. Hex grid,
 * cell 1.5 m. Tree trunks and boulders are COL_ colliders; canopies are visible only.
 *
 * Spawn points (hardcoded in src/ui/templates.ts, keep in sync). Both sit on hex centres of the
 * grid below (origin (0,0), pointy-top axial: x = 1.5 (q + r/2), z = 1.5 * sqrt(3)/2 * r):
 *   SPAWN_player    ( 0.75, 0, 1.299)  hex (0, 1), south-east of the fire
 *   SPAWN_player_2  (-0.75, 0, 1.299)  hex (-1, 1), south-west of the fire
 */
import { BufferAttribute, CylinderGeometry, Mesh } from 'three'
import {
  CELL, boulder, campfire, floorCollider, grid, group, mat, newScene, paint, palette, planeGeometry, spawn, tree, vertexMaterial,
  writeGlb,
} from './lib.mjs'

const SIZE = 24 // ground plane, a little wider than the 20 m clearing
const SQRT3 = Math.sqrt(3)
const hex = (q, r) => [CELL * (q + r / 2), CELL * (SQRT3 / 2) * r]

const scene = newScene('forest', { ambient_preset: 'forest' })

// Ground: a subdivided plane with gently varied vertex colours so the grass is not one flat tone.
const ground = planeGeometry(SIZE, SIZE, 0.75)
ground.rotateX(-Math.PI / 2)
{
  const pos = ground.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const t = 0.5 + 0.5 * Math.sin(x * 0.7 + 1.3) * Math.cos(z * 0.6 - 0.4)
    colors[i * 3] = 0.16 + 0.08 * t
    colors[i * 3 + 1] = 0.36 + 0.12 * t
    colors[i * 3 + 2] = 0.14 + 0.05 * t
  }
  ground.setAttribute('color', new BufferAttribute(colors, 3))
}
const groundMesh = new Mesh(ground, vertexMaterial())
groundMesh.name = 'ground'
scene.add(groundMesh)
scene.add(floorCollider(SIZE, SIZE))

// Dirt path from the south edge to the fire, as flat patches a hair above the ground.
const path = group('path')
const dirt = mat(palette.dirt)
for (let k = 0; k < 7; k++) {
  const z = 10.5 - k * 1.45
  const x = Math.sin(k * 0.9) * 0.6
  const p = new Mesh(planeGeometry(1.4 + (k % 2) * 0.3, 1.6, 0.8), dirt)
  p.name = 'path_patch'
  p.rotation.x = -Math.PI / 2
  p.rotation.z = Math.sin(k) * 0.3
  p.position.set(x, 0.01, z)
  path.add(p)
}
scene.add(path)

// Campfire at the centre of the clearing.
const [fireProp, fireLight] = campfire('LIGHT_campfire', [0, 0])
scene.add(fireProp, fireLight)

// Logs to sit on around the fire.
for (const a of [0.6, 2.4, 4.3]) {
  const seat = new Mesh(paint(new CylinderGeometry(0.18, 0.2, 1.6, 7), palette.bark, palette.barkLight), vertexMaterial())
  seat.name = 'log_seat'
  seat.position.set(Math.cos(a) * 2.4, 0.18, Math.sin(a) * 2.4)
  seat.rotation.set(Math.PI / 2, 0, a + Math.PI / 2)
  scene.add(seat)
}

// Trees: a ring around the clearing (radius 8..10.5) with a gap for the path to the south,
// plus a few inside the clearing. Deterministic pseudo-random jitter.
let seed = 7
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
const trees = group('trees')
const colliders = group('colliders')
let t = 0
for (let i = 0; i < 26; i++) {
  const a = (i / 26) * Math.PI * 2 + rnd() * 0.15
  // Path gap: skip trees pointing roughly south (+z).
  if (Math.abs(a - Math.PI / 2) < 0.22) continue
  const r = 8.2 + rnd() * 2.3
  const [x, z] = [Math.cos(a) * r, Math.sin(a) * r]
  const height = 4.5 + rnd() * 2.5
  const tint = rnd() < 0.3 ? palette.leafDark : palette.leaf
  const [g, c] = tree(`tree_${t++}`, [x, z], { height, trunkR: 0.22 + rnd() * 0.1, canopyR: 1.3 + rnd() * 0.6, tint })
  trees.add(g)
  colliders.add(c)
}
for (const [x, z] of [[-5.5, -3.5], [6.2, 2.4], [-4.8, 5.2]]) {
  const [g, c] = tree(`tree_${t++}`, [x, z], { height: 5.5, canopyR: 1.5 })
  trees.add(g)
  colliders.add(c)
}
scene.add(trees, colliders)

// Boulders
for (const [name, x, z, r, rot] of [
  ['boulder_1', 4.6, -4.2, 0.9, 0.4],
  ['boulder_2', 5.6, -3.4, 0.55, 1.9],
  ['boulder_3', -6.5, 1.2, 0.75, 2.6],
  ['boulder_4', 2.8, 6.4, 0.5, 0.9],
]) {
  const [m, c] = boulder(name, [x, z], r, rot)
  scene.add(m, c)
}

// Spawns on hex centres next to the fire, and the hex grid with its origin at the fire.
scene.add(spawn('SPAWN_player', hex(0, 1)))
scene.add(spawn('SPAWN_player_2', hex(-1, 1)))
scene.add(grid([0, 0], CELL, 'hex'))

await writeGlb(scene, 'forest.glb', { merge: [path] })
