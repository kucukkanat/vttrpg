#!/usr/bin/env node
/**
 * Generates the small library models used by the token and prop pickers:
 *
 *   public/library/props/*.glb   furniture and scenery (barrel, crate, table, chair, chest,
 *                                torch stand, bed, bookshelf, campfire, rock, cauldron,
 *                                weapon rack, well)
 *   public/library/minis/*.glb   stylised miniatures (mouse adventurer, rat, knight, goblin,
 *                                skeleton, wizard)
 *
 * Every model stands on y = 0, is centred on the origin and fits inside one 1.5 m grid cell
 * horizontally, so it can be dropped on the table without any scaling. Minis face +Z.
 *
 * The look is a painted tabletop miniature: chunky heroic proportions (heads about a third of the
 * height, big hands, oversized weapons and shields) so a mini reads at one cell from the orbit
 * camera. No textures: every non-emissive part gets baked vertex colours (palette colour x height
 * gradient x contact shadow x neighbour occlusion, see `bakeDiorama` in ../make-scenes/lib.mjs)
 * and shares the one `diorama` material; flames, embers, glowing eyes and the wizard's orb keep
 * their own emissive material. Each file is a few tens of kB.
 *
 *   npm run props        (regenerates every file and rebuilds index.json)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, CylinderGeometry, DodecahedronGeometry, Mesh, Vector3 } from 'three'
import {
  CELL, box, block, cone, cylinder, dioramaMaterial, exportDiorama, glow, group, light, mat, newScene, paint,
  palette, sphere,
} from '../make-scenes/lib.mjs'

const LIBRARY = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/library')

// ------------------------------------------------------------------ materials

const P = palette
const oak = mat(P.oak)
const darkOak = mat(P.darkOak)
const pine = mat(P.pine)
const iron = mat(P.iron)
const brass = mat(P.brass)
const gold = mat(P.gold)
const linen = mat(P.linen)
const wool = mat(P.wool)
const stone = mat(P.stone)
const stoneLight = mat(P.stoneLight)
const steel = mat(P.steel)
const steelDark = mat(P.steelDark)
const leather = mat(P.leather)
const ink = mat(P.ink)
const bone = mat(P.bone)
const flame = glow(P.flame, P.flameCore, 2.5)
const ember = glow(P.ember, P.emberCore, 1.5)

/** Cylinder from `a` to `b` (radius `ra` at a, `rb` at b): limbs, handles, tails. */
function rod(name, a, b, ra, rb, material, segments = 6) {
  const from = new Vector3(...a)
  const to = new Vector3(...b)
  const dir = to.clone().sub(from)
  const m = new Mesh(new CylinderGeometry(rb, ra, dir.length(), segments), material)
  m.name = name
  m.position.copy(from).add(to).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize())
  return m
}

/** Sphere squashed or stretched per axis. */
function blob(name, r, pos, [sx, sy, sz], material, segments = 8) {
  const m = sphere(name, r, pos, material, segments)
  m.scale.set(sx, sy, sz)
  return m
}

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
  g.add(cylinder('table_mug', 0.06, 0.05, 0.12, [0.3, 0.15], mat(P.tan), 8, 0.86))
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
  const spines = [P.wool, P.blue, P.bottleGreen, P.rust, P.purple].map((c) => mat(c))
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
    const s = sphere('campfire_stone', 0.12, [Math.cos(a) * 0.45, 0.07, Math.sin(a) * 0.45], mat(P.pebble), 5)
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
  const geo = paint(new DodecahedronGeometry(0.5, 0), P.boulder, P.boulderLight)
  geo.scale(1.15, 0.7, 0.95)
  const m = new Mesh(geo, dioramaMaterial())
  m.name = 'rock'
  m.position.y = 0.36
  m.rotation.y = 0.4
  const pebble = new Mesh(paint(new DodecahedronGeometry(0.16, 0), '#4e5052', '#7d8186'), dioramaMaterial())
  pebble.name = 'rock_pebble'
  pebble.position.set(0.5, 0.15, 0.25)
  pebble.scale.y = 0.7
  return group('rock_group', m, pebble)
}

/** Iron pot on three stubby legs over a small fire, a glowing brew inside. */
function cauldron() {
  const g = group('cauldron')
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    g.add(rod('cauldron_leg', [Math.cos(a) * 0.28, 0.3, Math.sin(a) * 0.28], [Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38], 0.06, 0.04, iron))
  }
  // Pot belly whose top is hidden under a thick rim; the brew sits just above the rim.
  g.add(blob('cauldron_pot', 0.44, [0, 0.5, 0], [1, 0.8, 1], iron, 12))
  g.add(cylinder('cauldron_rim', 0.3, 0.27, 0.08, [0, 0], iron, 12, 0.84))
  for (const sx of [-1, 1]) {
    const handle = cylinder('cauldron_ear', 0.07, 0.07, 0.04, [sx * 0.31, 0], iron, 8, 0.82)
    handle.rotation.z = Math.PI / 2
    g.add(handle)
  }
  const brew = glow(P.brew, P.brewCore, 0.9)
  g.add(cylinder('cauldron_brew', 0.26, 0.26, 0.02, [0, 0], brew, 12, 0.885))
  for (const [x, z, r] of [[0.1, 0.05, 0.06], [-0.12, -0.06, 0.045], [0.02, -0.14, 0.035]]) {
    g.add(sphere('cauldron_bubble', r, [x, 0.9, z], brew, 6))
  }
  for (const a of [0.4, 2.0]) {
    const log = cylinder('cauldron_log', 0.05, 0.05, 0.6, [0, 0], darkOak, 6, 0.06)
    log.rotation.set(Math.PI / 2, 0, a)
    g.add(log)
  }
  const coals = sphere('cauldron_embers', 0.12, [0, 0.08, 0], ember, 6)
  coals.scale.y = 0.5
  g.add(coals)
  return g
}

/** Wooden rack with a sword, a spear and an axe standing in it. */
function weaponRack() {
  const g = group('weapon_rack')
  for (const sx of [-1, 1]) {
    g.add(block('weapon_rack_post', [0.09, 1.15, 0.09], [sx * 0.6, 0], oak))
    g.add(block('weapon_rack_foot', [0.12, 0.07, 0.55], [sx * 0.6, 0], darkOak))
  }
  g.add(box('weapon_rack_top', [1.34, 0.09, 0.11], [0, 1.05, 0], darkOak))
  g.add(box('weapon_rack_shelf', [1.34, 0.06, 0.3], [0, 0.22, 0], darkOak))
  // Sword, point down on the shelf, leaning on the top bar.
  g.add(box('weapon_rack_sword_blade', [0.09, 0.75, 0.03], [-0.35, 0.62, 0.02], steel))
  g.add(box('weapon_rack_sword_guard', [0.26, 0.05, 0.06], [-0.35, 1.02, 0.07], brass))
  g.add(rod('weapon_rack_sword_grip', [-0.35, 1.04, 0.07], [-0.35, 1.22, 0.07], 0.025, 0.025, leather))
  g.add(sphere('weapon_rack_sword_pommel', 0.04, [-0.35, 1.25, 0.07], brass, 6))
  // Spear, taller than the rack.
  g.add(rod('weapon_rack_spear_shaft', [0, 0.25, 0], [0.03, 1.38, 0.06], 0.025, 0.025, oak))
  const tip = cone('weapon_rack_spear_tip', 0.06, 0.22, [0.035, 1.49, 0.065], steel, 4)
  g.add(tip)
  // Axe.
  g.add(rod('weapon_rack_axe_haft', [0.35, 0.25, 0], [0.37, 1.15, 0.07], 0.03, 0.03, oak))
  g.add(box('weapon_rack_axe_head', [0.26, 0.2, 0.04], [0.47, 1.05, 0.07], steelDark))
  // A round shield propped against the front.
  const shield = cylinder('weapon_rack_shield', 0.28, 0.28, 0.05, [0, 0], mat(P.red), 12, 0)
  shield.rotation.x = Math.PI / 2 - 0.25
  shield.position.set(0.05, 0.3, 0.28)
  g.add(shield)
  const boss = sphere('weapon_rack_shield_boss', 0.07, [0.05, 0.31, 0.31], iron, 6)
  g.add(boss)
  return g
}

/** Round stone well with a little gabled roof, crank and bucket. */
function well() {
  const g = group('well')
  g.add(cylinder('well_wall', 0.55, 0.6, 0.7, [0, 0], stone, 12))
  g.add(cylinder('well_cap', 0.62, 0.62, 0.1, [0, 0], stoneLight, 12, 0.73))
  g.add(cylinder('well_water', 0.44, 0.44, 0.02, [0, 0], mat('#22323a'), 12, 0.785))
  for (const sx of [-1, 1]) g.add(box('well_post', [0.1, 1.0, 0.1], [sx * 0.55, 1.2, 0], oak))
  for (const s of [-1, 1]) {
    const roof = box('well_roof', [0.72, 0.05, 1.3], [s * 0.27, 1.82, 0], darkOak)
    roof.rotation.z = -s * 0.65
    g.add(roof)
  }
  const axle = cylinder('well_axle', 0.05, 0.05, 1.2, [0, 0], darkOak, 6, 1.45)
  axle.rotation.z = Math.PI / 2
  g.add(axle)
  g.add(box('well_crank', [0.04, 0.22, 0.04], [0.64, 1.36, 0], iron))
  g.add(rod('well_rope', [0, 1.42, 0], [0, 1.0, 0], 0.012, 0.012, linen, 4))
  g.add(cylinder('well_bucket', 0.12, 0.09, 0.18, [0, 0], oak, 8, 0.92))
  g.add(cylinder('well_bucket_hoop', 0.125, 0.125, 0.03, [0, 0], iron, 8, 0.98))
  return g
}

// ------------------------------------------------------------------ minis

function mouseAdventurer() {
  const fur = mat(P.mouseFur)
  const pink = mat(P.pink)
  const cloak = mat(P.green)
  const g = group('mouse_adventurer')
  // Big feet, pear body, cloak and belt.
  for (const sx of [-1, 1]) g.add(blob('mouse_foot', 0.13, [sx * 0.15, 0.08, 0.1], [0.9, 0.6, 1.3], pink, 7))
  g.add(blob('mouse_body', 0.3, [0, 0.45, 0], [1, 1.15, 0.9], fur, 10))
  g.add(cone('mouse_cloak', 0.42, 0.72, [0, 0.42, -0.1], cloak, 10))
  g.add(cylinder('mouse_belt', 0.29, 0.3, 0.07, [0, 0], leather, 10, 0.36))
  g.add(sphere('mouse_clasp', 0.05, [0, 0.74, 0.2], gold, 6))
  // Big head (a third of the height with the ears) with round ears, snout and eyes.
  g.add(sphere('mouse_head', 0.3, [0, 1.0, 0.03], fur, 10))
  for (const sx of [-1, 1]) {
    g.add(blob('mouse_ear', 0.19, [sx * 0.27, 1.28, -0.04], [1, 1, 0.35], fur, 8))
    g.add(blob('mouse_ear_inner', 0.12, [sx * 0.27, 1.28, 0.0], [1, 1, 0.25], pink, 7))
    g.add(sphere('mouse_eye', 0.055, [sx * 0.12, 1.05, 0.28], ink, 6))
  }
  const snout = cone('mouse_snout', 0.13, 0.22, [0, 0.94, 0.36], fur, 8)
  snout.rotation.x = Math.PI / 2
  g.add(snout)
  g.add(sphere('mouse_nose', 0.055, [0, 0.94, 0.47], pink, 6))
  // Arms and big paws.
  for (const sx of [-1, 1]) {
    g.add(rod('mouse_arm', [sx * 0.24, 0.66, 0.02], [sx * 0.36, 0.52, 0.15], 0.07, 0.06, fur))
    g.add(sphere('mouse_paw', 0.09, [sx * 0.37, 0.5, 0.17], pink, 7))
  }
  // Oversized sword in the right paw, point up.
  const sword = group('mouse_sword')
  sword.add(box('mouse_sword_blade', [0.11, 0.78, 0.03], [0, 0.48, 0], steel))
  sword.add(cone('mouse_sword_tip', 0.078, 0.12, [0, 0.93, 0], steel, 4))
  sword.add(box('mouse_sword_guard', [0.3, 0.06, 0.08], [0, 0.07, 0], gold))
  sword.add(rod('mouse_sword_grip', [0, 0.04, 0], [0, -0.1, 0], 0.03, 0.03, leather))
  sword.add(sphere('mouse_sword_pommel', 0.045, [0, -0.13, 0], gold, 6))
  sword.position.set(0.38, 0.5, 0.2)
  sword.rotation.z = -0.12
  g.add(sword)
  // Big round shield on the left, facing forward.
  const shield = cylinder('mouse_shield', 0.32, 0.32, 0.06, [0, 0], mat(P.rust), 12, 0)
  shield.rotation.x = Math.PI / 2
  shield.position.set(-0.4, 0.6, 0.22)
  g.add(shield)
  const rim = cylinder('mouse_shield_rim', 0.35, 0.35, 0.04, [0, 0], steelDark, 12, 0)
  rim.rotation.x = Math.PI / 2
  rim.position.set(-0.4, 0.6, 0.18)
  g.add(rim)
  g.add(sphere('mouse_shield_boss', 0.08, [-0.4, 0.6, 0.26], gold, 7))
  // Tail curling out behind.
  g.add(rod('mouse_tail_a', [0, 0.2, -0.3], [0.12, 0.06, -0.62], 0.05, 0.035, pink))
  g.add(rod('mouse_tail_b', [0.12, 0.06, -0.62], [0.42, 0.05, -0.75], 0.035, 0.015, pink))
  return g
}

function rat() {
  const fur = mat(P.ratFur)
  const belly = mat(P.ratBelly)
  const pink = mat(P.pink)
  const eye = glow(P.red, P.eyeGlow, 1)
  const g = group('rat')
  // Hunched body with an arched back, haunches and a ridge of bristles.
  g.add(blob('rat_body', 0.38, [0, 0.5, -0.12], [0.95, 1, 1.25], fur, 10))
  for (const sx of [-1, 1]) g.add(blob('rat_haunch', 0.27, [sx * 0.2, 0.36, -0.32], [0.8, 1, 1.1], fur, 8))
  g.add(blob('rat_belly', 0.28, [0, 0.4, 0.08], [0.9, 0.9, 1], belly, 8))
  for (const [z, y] of [[-0.35, 0.83], [-0.15, 0.9], [0.05, 0.88]]) {
    const bristle = cone('rat_bristle', 0.07, 0.18, [0, y, z], mat(P.rock), 5)
    bristle.rotation.x = -0.4
    g.add(bristle)
  }
  // Big head with a long snout, teeth, ears and glowing eyes.
  g.add(blob('rat_head', 0.3, [0, 0.72, 0.3], [0.95, 0.85, 1.05], fur, 10))
  const snout = cone('rat_snout', 0.17, 0.3, [0, 0.66, 0.6], belly, 8)
  snout.rotation.x = Math.PI / 2
  g.add(snout)
  g.add(sphere('rat_nose', 0.055, [0, 0.66, 0.75], ink, 6))
  for (const sx of [-1, 1]) {
    g.add(box('rat_tooth', [0.04, 0.08, 0.03], [sx * 0.025, 0.55, 0.66], bone))
    g.add(blob('rat_ear', 0.15, [sx * 0.2, 0.98, 0.22], [1, 1, 0.35], belly, 8))
    g.add(blob('rat_ear_inner', 0.09, [sx * 0.2, 0.98, 0.26], [1, 1, 0.25], pink, 6))
    g.add(sphere('rat_eye', 0.055, [sx * 0.14, 0.8, 0.56], eye, 6))
    // Front legs and big clawed paws, hind feet.
    g.add(rod('rat_arm', [sx * 0.2, 0.45, 0.2], [sx * 0.22, 0.1, 0.38], 0.08, 0.06, fur))
    g.add(blob('rat_paw', 0.1, [sx * 0.22, 0.07, 0.42], [1, 0.6, 1.2], pink, 7))
    g.add(blob('rat_foot', 0.11, [sx * 0.27, 0.06, -0.24], [0.9, 0.55, 1.6], pink, 7))
  }
  // Tail curling round to the side.
  g.add(rod('rat_tail_a', [0, 0.3, -0.52], [0.3, 0.07, -0.62], 0.06, 0.045, mat(P.ratTail)))
  g.add(rod('rat_tail_b', [0.3, 0.07, -0.62], [0.62, 0.04, -0.35], 0.045, 0.02, mat(P.ratTail)))
  return g
}

function knight() {
  const tabard = mat(P.blue)
  const g = group('knight')
  // Chunky boots and legs.
  for (const sx of [-1, 1]) {
    g.add(box('knight_boot', [0.22, 0.14, 0.34], [sx * 0.14, 0.07, 0.05], steelDark))
    g.add(rod('knight_leg', [sx * 0.14, 0.12, 0], [sx * 0.14, 0.52, 0], 0.11, 0.12, steelDark, 8))
  }
  // Barrel chest, tabard with a gold cross, belt, big pauldrons.
  g.add(cylinder('knight_torso', 0.32, 0.26, 0.5, [0, 0], steel, 10, 0.76))
  g.add(box('knight_tabard', [0.38, 0.6, 0.06], [0, 0.66, 0.27], tabard))
  g.add(box('knight_tabard_cross_v', [0.07, 0.3, 0.02], [0, 0.75, 0.31], gold))
  g.add(box('knight_tabard_cross_h', [0.2, 0.07, 0.02], [0, 0.8, 0.31], gold))
  g.add(cylinder('knight_belt', 0.3, 0.3, 0.07, [0, 0], leather, 10, 0.52))
  for (const sx of [-1, 1]) {
    g.add(blob('knight_pauldron', 0.18, [sx * 0.36, 0.98, 0], [1, 0.8, 1], steel, 8))
    g.add(rod('knight_arm', [sx * 0.38, 0.92, 0], [sx * 0.42, 0.62, 0.12], 0.08, 0.08, steelDark))
    g.add(sphere('knight_gauntlet', 0.11, [sx * 0.42, 0.6, 0.15], steelDark, 7))
  }
  // Great helm, a third of the height: visor slit and a red crest.
  g.add(cylinder('knight_helm', 0.27, 0.27, 0.32, [0, 0.02], steel, 12, 1.16))
  g.add(blob('knight_helm_top', 0.27, [0, 1.32, 0.02], [1, 0.75, 1], steel, 12))
  g.add(box('knight_visor', [0.38, 0.05, 0.04], [0, 1.22, 0.28], ink))
  g.add(box('knight_breaths', [0.04, 0.12, 0.04], [0, 1.1, 0.29], ink))
  g.add(box('knight_crest', [0.07, 0.14, 0.44], [0, 1.55, -0.02], mat(P.red)))
  // Oversized sword raised in the right hand.
  g.add(box('knight_sword', [0.12, 0.92, 0.04], [0.44, 1.12, 0.17], steel))
  g.add(cone('knight_sword_tip', 0.085, 0.12, [0.44, 1.64, 0.17], steel, 4))
  g.add(box('knight_sword_guard', [0.34, 0.07, 0.09], [0.44, 0.65, 0.17], gold))
  g.add(sphere('knight_sword_pommel', 0.05, [0.44, 0.48, 0.17], gold, 6))
  // Big kite shield on the left with a gold cross.
  g.add(box('knight_shield', [0.48, 0.58, 0.07], [-0.46, 0.8, 0.24], tabard))
  g.add(box('knight_shield_rim', [0.54, 0.64, 0.05], [-0.46, 0.8, 0.2], steelDark))
  // Four-sided cone flattened in z: a downward point under the shield.
  const point = cone('knight_shield_point', 0.24, 0.3, [-0.46, 0.36, 0.24], tabard, 4)
  point.rotation.x = Math.PI
  point.scale.set(1, 1, 0.25)
  g.add(point)
  g.add(box('knight_shield_cross_v', [0.08, 0.5, 0.02], [-0.46, 0.78, 0.285], gold))
  g.add(box('knight_shield_cross_h', [0.36, 0.08, 0.02], [-0.46, 0.88, 0.285], gold))
  return g
}

function goblin() {
  const skin = mat(P.goblinSkin)
  const skinDark = mat(P.goblinDark)
  const g = group('goblin')
  // Bandy legs, big feet, a ragged tunic over a pot belly.
  for (const sx of [-1, 1]) {
    g.add(box('goblin_foot', [0.17, 0.08, 0.28], [sx * 0.14, 0.04, 0.06], leather))
    g.add(rod('goblin_leg', [sx * 0.14, 0.06, 0.02], [sx * 0.12, 0.36, 0], 0.06, 0.07, skinDark))
  }
  g.add(blob('goblin_body', 0.26, [0, 0.56, 0], [1, 1.05, 0.85], skin, 10))
  g.add(cylinder('goblin_tunic', 0.25, 0.31, 0.3, [0, 0], mat(P.rust), 8, 0.4))
  g.add(cylinder('goblin_belt', 0.26, 0.26, 0.06, [0, 0], leather, 8, 0.55))
  // Huge head with long ears, hook nose, yellow eyes and a tusky grin.
  g.add(blob('goblin_head', 0.3, [0, 0.98, 0.04], [1.05, 0.92, 0.95], skin, 10))
  for (const sx of [-1, 1]) {
    g.add(rod('goblin_ear', [sx * 0.26, 1.02, 0], [sx * 0.66, 1.16, -0.06], 0.1, 0.01, skin))
    g.add(blob('goblin_eye', 0.065, [sx * 0.12, 1.04, 0.28], [1, 0.8, 0.6], gold, 6))
    g.add(sphere('goblin_pupil', 0.03, [sx * 0.12, 1.04, 0.31], ink, 5))
    g.add(cone('goblin_tusk', 0.025, 0.08, [sx * 0.1, 0.86, 0.27], bone, 4))
  }
  g.add(rod('goblin_nose', [0, 1.0, 0.27], [0, 0.92, 0.4], 0.06, 0.02, skinDark))
  g.add(box('goblin_mouth', [0.22, 0.03, 0.03], [0, 0.84, 0.28], ink))
  // Arms ending in big hands.
  for (const sx of [-1, 1]) {
    g.add(rod('goblin_arm', [sx * 0.24, 0.7, 0], [sx * 0.34, 0.48, 0.14], 0.06, 0.055, skin))
    g.add(sphere('goblin_hand', 0.1, [sx * 0.35, 0.46, 0.16], skinDark, 7))
  }
  // A cleaver almost as big as he is.
  g.add(rod('goblin_cleaver_grip', [0.36, 0.38, 0.17], [0.36, 0.82, 0.17], 0.035, 0.035, leather))
  g.add(box('goblin_cleaver_blade', [0.05, 0.5, 0.4], [0.37, 0.98, 0.26], steel))
  g.add(box('goblin_cleaver_spine', [0.07, 0.5, 0.05], [0.37, 0.98, 0.06], steelDark))
  g.add(sphere('goblin_cleaver_rivet', 0.03, [0.4, 0.82, 0.12], brass, 5))
  return g
}

function skeleton() {
  const shade = mat(P.boneShadow)
  const g = group('skeleton')
  // Feet, shins, knees, thighs.
  for (const sx of [-1, 1]) {
    g.add(box('skeleton_foot', [0.14, 0.07, 0.26], [sx * 0.14, 0.035, 0.06], bone))
    g.add(rod('skeleton_shin', [sx * 0.14, 0.06, 0], [sx * 0.14, 0.34, 0], 0.045, 0.045, bone))
    g.add(sphere('skeleton_knee', 0.07, [sx * 0.14, 0.36, 0.01], bone, 6))
    g.add(rod('skeleton_thigh', [sx * 0.14, 0.38, 0], [sx * 0.12, 0.58, 0], 0.05, 0.05, bone))
  }
  // Pelvis, a tattered loincloth, spine and a chunky rib cage.
  g.add(box('skeleton_pelvis', [0.34, 0.1, 0.18], [0, 0.6, 0], bone))
  g.add(box('skeleton_loincloth', [0.22, 0.26, 0.04], [0, 0.5, 0.11], mat(P.wool)))
  g.add(rod('skeleton_spine', [0, 0.62, -0.04], [0, 1.0, -0.04], 0.045, 0.045, shade))
  for (const [y, w] of [[0.76, 0.34], [0.86, 0.4], [0.96, 0.42]]) {
    g.add(box('skeleton_rib', [w, 0.055, 0.26], [0, y, 0], bone))
  }
  g.add(box('skeleton_sternum', [0.07, 0.26, 0.04], [0, 0.86, 0.13], shade))
  g.add(box('skeleton_collar', [0.56, 0.06, 0.12], [0, 1.04, 0], bone))
  // Arms ending in big bony hands.
  for (const sx of [-1, 1]) {
    g.add(sphere('skeleton_shoulder', 0.08, [sx * 0.29, 1.03, 0], bone, 6))
    g.add(rod('skeleton_arm', [sx * 0.3, 1.0, 0], [sx * 0.38, 0.62, 0.12], 0.04, 0.04, bone))
    g.add(sphere('skeleton_hand', 0.08, [sx * 0.39, 0.6, 0.15], bone, 6))
  }
  // Big skull with dark sockets and a jaw, under a dented iron cap.
  g.add(blob('skeleton_skull', 0.25, [0, 1.25, 0.02], [1, 0.95, 1], bone, 10))
  g.add(box('skeleton_jaw', [0.26, 0.09, 0.2], [0, 1.04, 0.08], shade))
  for (const sx of [-1, 1]) g.add(blob('skeleton_socket', 0.07, [sx * 0.09, 1.25, 0.22], [1, 1.1, 0.5], ink, 6))
  g.add(cone('skeleton_nose', 0.035, 0.06, [0, 1.16, 0.25], ink, 3))
  g.add(blob('skeleton_cap', 0.27, [0, 1.38, 0.0], [1, 0.55, 1], iron, 10))
  // Rusty sword and a battered buckler.
  g.add(box('skeleton_sword', [0.1, 0.78, 0.035], [0.4, 1.02, 0.18], mat(P.rust)))
  g.add(box('skeleton_sword_guard', [0.26, 0.05, 0.07], [0.4, 0.64, 0.18], iron))
  g.add(rod('skeleton_sword_grip', [0.4, 0.62, 0.18], [0.4, 0.5, 0.18], 0.025, 0.025, leather))
  const buckler = cylinder('skeleton_buckler', 0.27, 0.27, 0.05, [0, 0], darkOak, 12, 0)
  buckler.rotation.x = Math.PI / 2
  buckler.position.set(-0.42, 0.68, 0.23)
  g.add(buckler)
  const rim = cylinder('skeleton_buckler_rim', 0.3, 0.3, 0.03, [0, 0], iron, 12, 0)
  rim.rotation.x = Math.PI / 2
  rim.position.set(-0.42, 0.68, 0.2)
  g.add(rim)
  g.add(sphere('skeleton_buckler_boss', 0.07, [-0.42, 0.68, 0.27], iron, 6))
  return g
}

function wizard() {
  const robe = mat(P.purple)
  const skin = mat(P.skin)
  const g = group('wizard')
  // Pointy boot tips under a wide robe, a gold belt and broad shoulders.
  for (const sx of [-1, 1]) g.add(blob('wizard_boot', 0.09, [sx * 0.13, 0.05, 0.3], [1, 0.6, 1.6], leather, 6))
  g.add(cylinder('wizard_robe', 0.18, 0.42, 0.92, [0, 0], robe, 12, 0.46))
  g.add(cylinder('wizard_hem', 0.43, 0.43, 0.05, [0, 0], gold, 12, 0.04))
  g.add(cylinder('wizard_belt', 0.28, 0.29, 0.06, [0, 0], gold, 12, 0.58))
  g.add(blob('wizard_shoulders', 0.25, [0, 0.88, 0], [1.15, 0.6, 0.9], robe, 10))
  // Big head with a long beard, nose and a tall wide-brimmed hat.
  g.add(sphere('wizard_head', 0.23, [0, 1.08, 0.03], skin, 10))
  const beard = cone('wizard_beard', 0.19, 0.42, [0, 0.78, 0.22], mat(P.beard), 8)
  beard.rotation.x = Math.PI - 0.15
  g.add(beard)
  g.add(sphere('wizard_nose', 0.055, [0, 1.06, 0.26], skin, 6))
  for (const sx of [-1, 1]) g.add(sphere('wizard_eye', 0.035, [sx * 0.085, 1.13, 0.22], ink, 5))
  g.add(cylinder('wizard_brim', 0.4, 0.4, 0.04, [0, 0.02], robe, 14, 1.26))
  g.add(cylinder('wizard_hatband', 0.22, 0.24, 0.07, [0, 0.02], gold, 12, 1.31))
  const hat = cone('wizard_hat', 0.24, 0.42, [0, 1.52, 0.0], robe, 10)
  hat.rotation.x = -0.25
  g.add(hat)
  // Left hand thrown out in a casting gesture.
  g.add(rod('wizard_sleeve_left', [-0.24, 0.9, 0], [-0.44, 0.74, 0.14], 0.09, 0.12, robe, 8))
  g.add(sphere('wizard_hand_left', 0.085, [-0.5, 0.72, 0.17], skin, 7))
  // Staff in the right hand, crowned by a glowing orb in three wooden claws.
  g.add(rod('wizard_sleeve_right', [0.24, 0.9, 0], [0.4, 0.8, 0.14], 0.09, 0.12, robe, 8))
  g.add(sphere('wizard_hand_right', 0.085, [0.43, 0.8, 0.18], skin, 7))
  g.add(rod('wizard_staff', [0.43, 0.02, 0.18], [0.45, 1.42, 0.18], 0.035, 0.045, oak))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    g.add(rod('wizard_staff_claw', [0.45, 1.4, 0.18], [0.45 + Math.cos(a) * 0.1, 1.58, 0.18 + Math.sin(a) * 0.1], 0.03, 0.015, darkOak))
  }
  g.add(sphere('wizard_orb', 0.1, [0.45, 1.54, 0.18], glow(P.arcane, P.arcaneCore, 2), 8))
  return g
}

// ------------------------------------------------------------------ output

const PROPS = {
  barrel, crate, table, chair, chest, 'torch-stand': torchStand, bed, bookshelf, campfire, rock, cauldron,
  'weapon-rack': weaponRack, well,
}
const MINIS = { 'mouse-adventurer': mouseAdventurer, rat, knight, goblin, skeleton, wizard }

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
  const glb = await exportDiorama(scene, { height, merge: model })
  const out = resolve(LIBRARY, folder, `${name}.glb`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(glb))
  console.log(`wrote ${folder}/${name}.glb  ${width.toFixed(2)} x ${height.toFixed(2)} m  (${(glb.byteLength / 1024).toFixed(1)} kB)`)
}

for (const [name, build] of Object.entries(PROPS)) await writeModel('props', name, build)
for (const [name, build] of Object.entries(MINIS)) await writeModel('minis', name, build)
