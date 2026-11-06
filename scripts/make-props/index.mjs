#!/usr/bin/env node
/**
 * Generates the small library models used by the token and prop pickers:
 *
 *   public/library/props/*.glb   furniture and scenery (barrel, crate, table, chair, chest,
 *                                torch stand, bed, bookshelf, campfire, rock)
 *   public/library/minis/*.glb   stylised miniatures (mouse adventurer, rat, knight)
 *
 * Every model stands on y = 0, is centred on the origin and fits inside one 1.5 m grid cell
 * horizontally, so it can be dropped on the table without any scaling. Flat materials, no
 * textures: each file is a few kB. Low-poly on purpose, meant to read at one cell from the
 * orbit camera rather than up close.
 *
 *   npm run props        (regenerates every file and rebuilds index.json)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, DodecahedronGeometry, Mesh, Vector3 } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { CELL, box, block, cone, cylinder, group, light, mat, newScene, paint, sphere, vertexMaterial } from '../make-scenes/lib.mjs'

const LIBRARY = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/library')

// ------------------------------------------------------------------ palette

const oak = mat('#7a5a36')
const darkOak = mat('#5a3f24')
const pine = mat('#a07c4a')
const iron = mat('#3b3d42', { roughness: 0.6, metalness: 0.5 })
const brass = mat('#b08a3c', { roughness: 0.5, metalness: 0.6 })
const linen = mat('#d9cdb4')
const wool = mat('#8c3b3b')
const stone = mat('#6a6c70')
const flame = mat('#ffb347', { emissive: '#ff6a00', emissiveIntensity: 2.5 })
const ember = mat('#ff7a1a', { emissive: '#ff3c00', emissiveIntensity: 1.5 })

// ------------------------------------------------------------------ props

function barrel() {
  const g = group('barrel')
  g.add(cylinder('barrel_body', 0.32, 0.28, 0.9, [0, 0], oak, 10, 0.45))
  g.add(cylinder('barrel_bulge', 0.35, 0.35, 0.3, [0, 0], oak, 10, 0.45))
  for (const y of [0.18, 0.72]) g.add(cylinder(`barrel_hoop`, 0.345, 0.345, 0.05, [0, 0], iron, 10, y))
  g.add(cylinder('barrel_lid', 0.3, 0.3, 0.03, [0, 0], darkOak, 10, 0.91))
  return g
}

function crate() {
  const s = 0.8
  const g = group('crate')
  g.add(block('crate_body', [s, s, s], [0, 0], pine))
  // Edge battens on the four vertical corners and a cross brace on two faces.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(block('crate_batten', [0.07, s + 0.02, 0.07], [sx * s / 2, sz * s / 2], darkOak))
  }
  for (const side of [-1, 1]) {
    const brace = box('crate_brace', [s * 1.2, 0.06, 0.04], [0, s / 2, side * (s / 2 + 0.01)], darkOak)
    brace.rotation.z = Math.PI / 4
    g.add(brace)
  }
  return g
}

function table() {
  const w = 1.3, d = 0.8
  const g = group('table')
  g.add(box('table_top', [w, 0.08, d], [0, 0.76, 0], oak))
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box('table_leg', [0.1, 0.72, 0.1], [sx * (w / 2 - 0.1), 0.36, sz * (d / 2 - 0.1)], darkOak))
  }
  g.add(box('table_stretcher', [w - 0.3, 0.06, 0.06], [0, 0.2, 0], darkOak))
  // A mug and a candle so the top is not bare.
  g.add(cylinder('table_mug', 0.06, 0.05, 0.12, [0.3, 0.15], mat('#8d6e4a'), 8, 0.86))
  g.add(cylinder('table_candle', 0.025, 0.03, 0.14, [-0.25, -0.1], linen, 6, 0.87))
  g.add(sphere('table_candle_flame', 0.03, [-0.25, 0.97, -0.1], flame, 5))
  return g
}

function chair() {
  const g = group('chair')
  g.add(box('chair_seat', [0.5, 0.06, 0.5], [0, 0.45, 0], oak))
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box('chair_leg', [0.06, 0.45, 0.06], [sx * 0.2, 0.225, sz * 0.2], darkOak))
  }
  for (const sx of [-1, 1]) g.add(box('chair_post', [0.06, 0.55, 0.06], [sx * 0.2, 0.75, -0.22], darkOak))
  g.add(box('chair_back', [0.46, 0.22, 0.05], [0, 0.88, -0.22], oak))
  return g
}

function chest() {
  const w = 0.9, h = 0.45, d = 0.55
  const g = group('chest')
  g.add(block('chest_body', [w, h, d], [0, 0], oak))
  const lid = cylinder('chest_lid', d / 2, d / 2, w, [0, 0], darkOak, 10, h)
  lid.rotation.z = Math.PI / 2
  lid.scale.set(1, 1, 0.6)
  g.add(lid)
  for (const x of [-0.3, 0.3]) g.add(box('chest_band', [0.06, h + 0.02, d + 0.02], [x, h / 2, 0], iron))
  g.add(box('chest_lock', [0.1, 0.12, 0.04], [0, h - 0.05, d / 2 + 0.02], brass))
  return g
}

function torchStand() {
  const g = group('torch_stand')
  g.add(cylinder('torch_stand_base', 0.22, 0.26, 0.06, [0, 0], iron, 8, 0.03))
  g.add(cylinder('torch_stand_pole', 0.03, 0.04, 1.3, [0, 0], iron, 6, 0.7))
  g.add(cylinder('torch_stand_cup', 0.12, 0.06, 0.18, [0, 0], iron, 8, 1.42))
  g.add(cone('torch_stand_flame', 0.1, 0.3, [0, 1.62, 0], flame, 6))
  g.add(light('LIGHT_torch_stand', [0, 1.75, 0], { flicker: 0.6, intensity: 35, color_temp: 2000 }))
  return g
}

function bed() {
  const w = 0.9, d = 1.4
  const g = group('bed')
  g.add(block('bed_frame', [w, 0.3, d], [0, 0], darkOak))
  g.add(box('bed_mattress', [w - 0.1, 0.12, d - 0.1], [0, 0.36, 0], linen))
  g.add(box('bed_blanket', [w - 0.1, 0.06, d * 0.6], [0, 0.45, d * 0.15], wool))
  g.add(box('bed_pillow', [w - 0.3, 0.1, 0.3], [0, 0.47, -d / 2 + 0.25], linen))
  g.add(box('bed_headboard', [w, 0.5, 0.06], [0, 0.55, -d / 2 + 0.03], oak))
  g.add(box('bed_footboard', [w, 0.2, 0.06], [0, 0.4, d / 2 - 0.03], oak))
  return g
}

function bookshelf() {
  const w = 1.0, h = 1.5, d = 0.35
  const g = group('bookshelf')
  g.add(box('bookshelf_back', [w, h, 0.04], [0, h / 2, -d / 2 + 0.02], darkOak))
  for (const sx of [-1, 1]) g.add(block('bookshelf_side', [0.05, h, d], [sx * (w / 2 - 0.025), 0], oak))
  const shelves = [0.05, 0.42, 0.8, 1.18, h - 0.03]
  for (const y of shelves) g.add(box('bookshelf_shelf', [w - 0.1, 0.04, d], [0, y, 0], oak))
  // Rows of books: alternating heights and spines in a few colours.
  const spines = ['#8c3b3b', '#3b5a8c', '#4a7a3b', '#a06a2a', '#5a3f6b'].map((c) => mat(c))
  let i = 0
  for (const y of shelves.slice(0, 3)) {
    for (let x = -w / 2 + 0.1; x < w / 2 - 0.16; x += 0.13) {
      const bh = 0.22 + ((i * 7) % 3) * 0.04
      g.add(box('bookshelf_book', [0.11, bh, d - 0.1], [x + 0.055, y + 0.02 + bh / 2, 0.01], spines[i % spines.length]))
      i++
    }
  }
  return g
}

function campfire() {
  const g = group('campfire')
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const s = sphere('campfire_stone', 0.12, [Math.cos(a) * 0.45, 0.07, Math.sin(a) * 0.45], stone, 5)
    s.scale.y = 0.6
    g.add(s)
  }
  for (const a of [0.3, 1.4, 2.5]) {
    const log = cylinder('campfire_log', 0.06, 0.06, 0.7, [0, 0], darkOak, 6, 0.09)
    log.rotation.set(Math.PI / 2, 0, a)
    g.add(log)
  }
  const embers = sphere('campfire_embers', 0.16, [0, 0.1, 0], ember, 6)
  embers.scale.y = 0.5
  g.add(embers)
  g.add(cone('campfire_flame', 0.2, 0.45, [0, 0.38, 0], flame, 6))
  g.add(cone('campfire_flame_tip', 0.1, 0.3, [0.05, 0.62, -0.03], flame, 5))
  g.add(light('LIGHT_campfire', [0, 0.8, 0], { flicker: 0.7, intensity: 45, color_temp: 1900 }))
  return g
}

function rock() {
  const geo = paint(new DodecahedronGeometry(0.5, 0), '#56585a', '#8d9196')
  geo.scale(1.15, 0.7, 0.95)
  const m = new Mesh(geo, vertexMaterial())
  m.name = 'rock'
  m.position.y = 0.36
  m.rotation.y = 0.4
  const pebble = new Mesh(paint(new DodecahedronGeometry(0.16, 0), '#4e5052', '#7d8186'), vertexMaterial())
  pebble.name = 'rock_pebble'
  pebble.position.set(0.5, 0.15, 0.25)
  pebble.scale.y = 0.7
  return group('rock_group', m, pebble)
}

// ------------------------------------------------------------------ minis

/** Thin tapered tail laid on the floor behind the body, bent once. */
function tail(name, [x, z], len, material, angle) {
  const g = group(name)
  const a = cylinder(`${name}_a`, 0.035, 0.05, len * 0.55, [0, 0], material, 6, 0)
  a.rotation.set(Math.PI / 2, 0, angle)
  a.position.set(x, 0.05, z + len * 0.27)
  const b = cylinder(`${name}_b`, 0.015, 0.035, len * 0.5, [0, 0], material, 6, 0)
  b.rotation.set(Math.PI / 2, 0, angle + 0.9)
  b.position.set(x + Math.sin(angle + 0.9) * len * 0.2, 0.05, z + len * 0.55 + Math.cos(angle + 0.9) * len * 0.2)
  g.add(a, b)
  return g
}

function mouseAdventurer() {
  const fur = mat('#b89a78')
  const pinkish = mat('#e0a8a0')
  const cloak = mat('#3f6b4a')
  const g = group('mouse_adventurer')
  // Feet, body, cloak.
  for (const sx of [-1, 1]) {
    const foot = sphere('mouse_foot', 0.1, [sx * 0.14, 0.08, 0.08], pinkish, 6)
    foot.scale.y = 0.8
    g.add(foot)
  }
  const body = sphere('mouse_body', 0.3, [0, 0.5, 0], fur, 8)
  body.scale.set(1, 1.25, 0.9)
  g.add(body)
  g.add(cone('mouse_cloak', 0.42, 0.75, [0, 0.45, -0.08], cloak, 8))
  // Head with big round ears, snout and eyes.
  g.add(sphere('mouse_head', 0.26, [0, 1.05, 0.02], fur, 8))
  for (const sx of [-1, 1]) {
    const ear = sphere('mouse_ear', 0.15, [sx * 0.24, 1.3, -0.03], fur, 7)
    ear.scale.set(1, 1, 0.35)
    g.add(ear)
    g.add(sphere('mouse_eye', 0.04, [sx * 0.1, 1.1, 0.24], mat('#1a1612'), 5))
  }
  const snout = cone('mouse_snout', 0.1, 0.22, [0, 0.98, 0.3], fur, 6)
  snout.rotation.x = Math.PI / 2
  g.add(snout)
  g.add(sphere('mouse_nose', 0.04, [0, 0.98, 0.41], pinkish, 5))
  // Sword in the right paw, round shield on the left.
  const sword = box('mouse_sword', [0.04, 0.7, 0.04], [0.36, 0.85, 0.12], iron)
  sword.rotation.z = -0.25
  g.add(sword)
  g.add(box('mouse_sword_guard', [0.16, 0.04, 0.04], [0.33, 0.6, 0.12], brass))
  g.add(cylinder('mouse_shield', 0.2, 0.2, 0.04, [-0.36, 0.1], mat('#8c5a2a'), 10, 0.6))
  g.add(tail('mouse_tail', [0.05, -0.25], 0.7, pinkish, 0.3))
  return g
}

function rat() {
  const fur = mat('#6b625a')
  const belly = mat('#8d847a')
  const g = group('rat')
  // Long low body, haunches, head pointing +z.
  const body = sphere('rat_body', 0.3, [0, 0.3, -0.05], fur, 8)
  body.scale.set(0.9, 0.85, 1.5)
  g.add(body)
  const haunch = sphere('rat_haunch', 0.26, [0, 0.3, -0.3], fur, 7)
  haunch.scale.set(1.1, 1, 0.9)
  g.add(haunch)
  const head = sphere('rat_head', 0.2, [0, 0.36, 0.42], fur, 7)
  head.scale.set(0.9, 0.85, 1.2)
  g.add(head)
  const snout = cone('rat_snout', 0.1, 0.25, [0, 0.32, 0.7], belly, 6)
  snout.rotation.x = Math.PI / 2
  g.add(snout)
  g.add(sphere('rat_nose', 0.035, [0, 0.32, 0.82], mat('#2a1f1c'), 5))
  for (const sx of [-1, 1]) {
    const ear = sphere('rat_ear', 0.08, [sx * 0.14, 0.52, 0.36], belly, 6)
    ear.scale.z = 0.4
    g.add(ear)
    g.add(sphere('rat_eye', 0.03, [sx * 0.09, 0.4, 0.58], mat('#c23b2a', { emissive: '#5a0f08', emissiveIntensity: 1 }), 5))
    // Four legs.
    for (const z of [0.2, -0.3]) g.add(cylinder('rat_leg', 0.04, 0.05, 0.22, [sx * 0.2, z], fur, 6, 0.11))
  }
  for (const sx of [-1, 1]) for (const z of [0.3, -0.2]) g.add(sphere('rat_paw', 0.06, [sx * 0.22, 0.06, z], belly, 5))
  g.add(tail('rat_tail', [0, -0.6], 0.8, mat('#a08478'), -0.2))
  return g
}

function knight() {
  const steel = mat('#9aa3ad', { roughness: 0.45, metalness: 0.7 })
  const steelDark = mat('#5d666f', { roughness: 0.5, metalness: 0.7 })
  const tabard = mat('#2f4f8c')
  const plume = mat('#c23b2a')
  const g = group('knight')
  // Legs, boots.
  for (const sx of [-1, 1]) {
    g.add(cylinder('knight_leg', 0.1, 0.12, 0.55, [sx * 0.14, 0], steelDark, 8, 0.3))
    g.add(box('knight_boot', [0.18, 0.1, 0.3], [sx * 0.14, 0.05, 0.04], steelDark))
  }
  // Torso with a tabard, pauldrons, belt.
  const torso = cylinder('knight_torso', 0.26, 0.22, 0.6, [0, 0], steel, 8, 0.88)
  g.add(torso)
  g.add(box('knight_tabard', [0.3, 0.62, 0.06], [0, 0.78, 0.22], tabard))
  g.add(cylinder('knight_belt', 0.25, 0.25, 0.06, [0, 0], mat('#4a2e14'), 8, 0.6))
  for (const sx of [-1, 1]) {
    g.add(sphere('knight_pauldron', 0.15, [sx * 0.3, 1.14, 0], steel, 7))
    g.add(cylinder('knight_arm', 0.07, 0.08, 0.5, [sx * 0.34, 0.02], steelDark, 7, 0.82))
  }
  // Helmet with a visor slit and a plume.
  g.add(cylinder('knight_helm', 0.19, 0.19, 0.3, [0, 0.02], steel, 10, 1.4))
  g.add(sphere('knight_helm_top', 0.19, [0, 1.55, 0.02], steel, 10))
  g.add(box('knight_visor', [0.26, 0.04, 0.05], [0, 1.42, 0.19], mat('#15171a')))
  const crest = cone('knight_plume', 0.07, 0.4, [0, 1.85, -0.08], plume, 6)
  crest.rotation.x = 0.35
  g.add(crest)
  // Sword raised in the right hand, kite shield on the left.
  g.add(box('knight_sword', [0.05, 0.95, 0.05], [0.4, 1.15, 0.1], steel))
  g.add(box('knight_sword_guard', [0.22, 0.05, 0.06], [0.4, 0.72, 0.1], brass))
  g.add(cylinder('knight_sword_grip', 0.03, 0.03, 0.2, [0.4, 0.1], mat('#4a2e14'), 6, 0.6))
  const shield = box('knight_shield', [0.34, 0.5, 0.06], [-0.42, 0.85, 0.12], tabard)
  g.add(shield)
  g.add(box('knight_shield_rim', [0.38, 0.54, 0.04], [-0.42, 0.85, 0.09], steelDark))
  g.add(cone('knight_shield_point', 0.17, 0.2, [-0.42, 0.5, 0.11], tabard, 4))
  return g
}

// ------------------------------------------------------------------ output

const PROPS = { barrel, crate, table, chair, chest, 'torch-stand': torchStand, bed, bookshelf, campfire, rock }
const MINIS = { 'mouse-adventurer': mouseAdventurer, rat, knight }

/** Largest horizontal extent of the model in metres, to keep every file inside one cell. */
function footprint(object) {
  object.updateWorldMatrix(true, true)
  const box = new Box3().setFromObject(object, true)
  const size = box.getSize(new Vector3())
  return { width: Math.max(size.x, size.z), height: size.y, minY: box.min.y }
}

async function writeModel(folder, name, build) {
  const scene = newScene(name, { kind: folder === 'minis' ? 'mini' : 'prop' })
  const model = build()
  scene.add(model)
  const { width, height, minY } = footprint(model)
  if (width > CELL + 1e-6) throw new Error(`${name}: ${width.toFixed(2)} m wide, must fit a ${CELL} m cell`)
  if (minY < -0.02) throw new Error(`${name}: sinks ${(-minY).toFixed(2)} m under the floor`)
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true })
  const out = resolve(LIBRARY, folder, `${name}.glb`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(glb))
  console.log(`wrote ${folder}/${name}.glb  ${width.toFixed(2)} x ${height.toFixed(2)} m  (${(glb.byteLength / 1024).toFixed(1)} kB)`)
}

for (const [name, build] of Object.entries(PROPS)) await writeModel('props', name, build)
for (const [name, build] of Object.entries(MINIS)) await writeModel('minis', name, build)
