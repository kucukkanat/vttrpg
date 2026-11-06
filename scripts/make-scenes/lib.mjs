/**
 * Shared helpers for the generated starter scenes. Every scene follows the Blender naming
 * convention documented in public/library/scenes/README.md:
 *
 *   COL_*   meshes  -> colliders / line-of-sight walls (hidden after load)
 *   WALL_*  meshes  -> visible walls, faded when viewed from above (<= 0.3 m thick)
 *   LIGHT_* nodes   -> a holder node with `flicker` / `color_temp` userData and a PointLight child
 *   SPAWN_* empties -> token spawn points
 *   GRID    empty   -> grid origin; userData `cell_size`, `type`
 *   FOG_*   meshes  -> regions that start hidden
 *   scene userData `ambient_audio`, `ambient_preset`
 *
 * Units are metres, +Y is up, the floor is at y = 0. No textures: flat materials or vertex colours
 * keep each file well under 500 kB.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, Mesh,
  MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Scene, SphereGeometry,
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

export const SCENES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/library/scenes')
export const CELL = 1.5

// ------------------------------------------------------------------ materials

const materials = new Map()
/** Flat material per colour, shared so the exporter emits each colour once. */
export function mat(color, { roughness = 0.9, metalness = 0, emissive, emissiveIntensity = 1 } = {}) {
  const key = `${color}|${roughness}|${metalness}|${emissive ?? ''}|${emissiveIntensity}`
  let m = materials.get(key)
  if (!m) {
    m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness })
    if (emissive) { m.emissive = new Color(emissive); m.emissiveIntensity = emissiveIntensity }
    materials.set(key, m)
  }
  return m
}

let vertexMat = null
/** One shared material that reads vertex colours; used for organic props (trees, rocks). */
export function vertexMaterial() {
  return (vertexMat ??= new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }))
}

/** Paints every vertex of a geometry, optionally varying by height (y in [0,1] -> `top`). */
export function paint(geometry, color, top) {
  const pos = geometry.getAttribute('position')
  const base = new Color(color)
  const hi = top ? new Color(top) : base
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox
  const span = Math.max(1e-6, max.y - min.y)
  const colors = new Float32Array(pos.count * 3)
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / span
    c.copy(base).lerp(hi, t)
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

// ------------------------------------------------------------------ primitives

export function box(name, [w, h, d], [x, y, z], material, rotY = 0) {
  const m = new Mesh(new BoxGeometry(w, h, d), material)
  m.name = name
  m.position.set(x, y, z)
  m.rotation.y = rotY
  return m
}

/** A box standing on the floor (y measured from 0). */
export function block(name, [w, h, d], [x, z], material, rotY = 0) {
  return box(name, [w, h, d], [x, h / 2, z], material, rotY)
}

export function cylinder(name, rTop, rBottom, h, [x, z], material, segments = 8, y = h / 2) {
  const m = new Mesh(new CylinderGeometry(rTop, rBottom, h, segments), material)
  m.name = name
  m.position.set(x, y, z)
  return m
}

export function cone(name, r, h, [x, y, z], material, segments = 8) {
  const m = new Mesh(new ConeGeometry(r, h, segments), material)
  m.name = name
  m.position.set(x, y, z)
  return m
}

export function sphere(name, r, [x, y, z], material, segments = 8) {
  const m = new Mesh(new SphereGeometry(r, segments, Math.max(4, segments / 2)), material)
  m.name = name
  m.position.set(x, y, z)
  return m
}

export function floor(name, w, d, material, [x = 0, z = 0] = [], y = 0) {
  const m = new Mesh(new PlaneGeometry(w, d), material)
  m.name = name
  m.rotation.x = -Math.PI / 2
  m.position.set(x, y, z)
  return m
}

// ------------------------------------------------------------------ convention objects

/**
 * Visible wall (`WALL_<name>`, faded by the table when the camera looks down from above; keep it
 * at most 0.3 m thick) plus a matching `COL_wall_<name>` collider. Returns [visible, collider].
 */
export function wall(name, [w, h, d], [x, z], material, rotY = 0) {
  const v = block(`WALL_${name}`, [w, h, d], [x, z], material, rotY)
  const c = block(`COL_wall_${name}`, [w, h, d], [x, z], material, rotY)
  return [v, c]
}

/** Invisible-after-load collider box standing on the floor. */
export function collider(name, [w, h, d], [x, z], rotY = 0) {
  return block(`COL_${name}`, [w, h, d], [x, z], mat('#555555'), rotY)
}

/** Thin collider slab under the whole floor so the loader has a floor to raycast. */
export function floorCollider(w, d, [x = 0, z = 0] = []) {
  return box('COL_floor', [w, 0.1, d], [x, -0.05, z], mat('#555555'))
}

/**
 * Light following the Blender export shape: a node named LIGHT_* carrying the custom properties,
 * with the PointLight as its child.
 */
export function light(name, [x, y, z], { intensity = 60, flicker, color_temp = 2200, distance = 0 } = {}) {
  const holder = new Object3D()
  holder.name = name
  holder.position.set(x, y, z)
  holder.userData = flicker !== undefined ? { flicker, color_temp } : { color_temp }
  const l = new PointLight(0xffffff, intensity, distance, 2)
  l.name = `${name}_light`
  holder.add(l)
  return holder
}

export function spawn(name, [x, z], y = 0) {
  const o = new Object3D()
  o.name = name
  o.position.set(x, y, z)
  return o
}

/** GRID empty at the centre of cell (0,0). */
export function grid([x, z], cellSize = CELL, type = 'square') {
  const o = new Object3D()
  o.name = 'GRID'
  o.position.set(x, 0, z)
  o.userData = { cell_size: cellSize, type }
  return o
}

/** FOG_ region: a flat box just above the floor covering [w x d] centred at (x, z). */
export function fog(name, [w, d], [x, z]) {
  return box(name, [w, 0.1, d], [x, 0.05, z], mat('#222233'))
}

export function group(name, ...children) {
  const g = new Group()
  g.name = name
  const kids = children.flat()
  if (kids.length) g.add(...kids)
  return g
}

// ------------------------------------------------------------------ props

/** A torch bracket on a wall: a short stick, a flame blob and the LIGHT_ node. */
export function torch(name, [x, y, z], { flicker = 0.6, intensity = 50 } = {}) {
  const g = new Group()
  g.name = `${name}_prop`
  const stick = cylinder(`${name}_stick`, 0.03, 0.04, 0.4, [0, 0], mat('#4a3620'), 6, 0)
  stick.position.set(x, y - 0.25, z)
  const flame = sphere(`${name}_flame`, 0.09, [x, y, z], mat('#ffb347', { emissive: '#ff7a1a', emissiveIntensity: 2 }), 6)
  g.add(stick, flame)
  return [g, light(name, [x, y + 0.1, z], { flicker, intensity, color_temp: 2000 })]
}

/** Four-legged table with two benches along its long sides. Returns a group plus one collider. */
export function tableWithBenches(name, [x, z], { w = 2.2, d = 1.0, rotY = 0 } = {}) {
  const wood = mat('#7a5a36')
  const dark = mat('#5a3f24')
  const g = new Group()
  g.name = name
  g.position.set(x, 0, z)
  g.rotation.y = rotY
  const top = box(`${name}_top`, [w, 0.08, d], [0, 0.78, 0], wood)
  g.add(top)
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box(`${name}_leg`, [0.1, 0.74, 0.1], [sx * (w / 2 - 0.1), 0.37, sz * (d / 2 - 0.1)], dark))
  }
  for (const side of [-1, 1]) {
    const bz = side * (d / 2 + 0.35)
    g.add(box(`${name}_bench`, [w * 0.9, 0.06, 0.3], [0, 0.45, bz], wood))
    g.add(box(`${name}_bench_leg`, [0.08, 0.42, 0.25], [-(w * 0.9) / 2 + 0.1, 0.21, bz], dark))
    g.add(box(`${name}_bench_leg`, [0.08, 0.42, 0.25], [(w * 0.9) / 2 - 0.1, 0.21, bz], dark))
  }
  const col = block(`COL_${name}`, [w, 0.8, d], [x, z], mat('#555555'), rotY)
  return [g, col]
}

/**
 * Low-poly tree: trunk cylinder (also the collider) plus two cone canopies. Geometry is shared per
 * tint and scaled per tree so a forest of them stays small on disk.
 */
const treeGeos = new Map()
function treeGeometry(tint, top) {
  let g = treeGeos.get(tint)
  if (!g) {
    g = {
      trunk: paint(new CylinderGeometry(0.7, 1, 1, 7), '#4a3320', '#6b4a2e'),
      canopy: paint(new ConeGeometry(1, 1, 8), tint, top),
      col: new CylinderGeometry(1, 1, 1, 6),
    }
    treeGeos.set(tint, g)
  }
  return g
}
export function tree(name, [x, z], { height = 5, trunkR = 0.25, canopyR = 1.6, tint = '#2d5a27', top = '#4f8a3a' } = {}) {
  const vm = vertexMaterial()
  const geo = treeGeometry(tint, top)
  const trunkH = height * 0.4
  const trunk = new Mesh(geo.trunk, vm)
  trunk.name = `${name}_trunk`
  trunk.position.set(x, trunkH / 2, z)
  trunk.scale.set(trunkR, trunkH, trunkR)
  const h1 = height * 0.55
  const c1 = new Mesh(geo.canopy, vm)
  c1.name = `${name}_canopy`
  c1.position.set(x, trunkH + h1 / 2 - 0.2, z)
  c1.scale.set(canopyR, h1, canopyR)
  const h2 = height * 0.4
  const c2 = new Mesh(geo.canopy, vm)
  c2.name = `${name}_canopy_top`
  c2.position.set(x, trunkH + h1 + h2 / 2 - 0.6, z)
  c2.scale.set(canopyR * 0.65, h2, canopyR * 0.65)
  const col = new Mesh(geo.col, mat('#555555'))
  col.name = `COL_${name}`
  col.position.set(x, trunkH / 2, z)
  col.scale.set(trunkR, trunkH, trunkR)
  return [group(name, trunk, c1, c2), col]
}

/** Boulder: a squashed dodecahedron with vertex colours plus a collider. */
export function boulder(name, [x, z], r = 0.7, rotY = 0) {
  const geo = paint(new DodecahedronGeometry(r, 0), '#56585a', '#8d9196')
  geo.scale(1, 0.65, 1)
  const m = new Mesh(geo, vertexMaterial())
  m.name = name
  m.position.set(x, r * 0.45, z)
  m.rotation.y = rotY
  const col = cylinder(`COL_${name}`, r * 0.9, r * 0.9, r, [x, z], mat('#555555'), 6)
  return [m, col]
}

/** Campfire: a stone ring, logs, a flame and a flickering LIGHT_. */
export function campfire(name, [x, z]) {
  const g = new Group()
  g.name = `${name}_prop`
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const s = sphere(`${name}_stone`, 0.14, [x + Math.cos(a) * 0.55, 0.08, z + Math.sin(a) * 0.55], mat('#6a6c70'), 5)
    s.scale.y = 0.6
    g.add(s)
  }
  for (const a of [0.3, 1.4, 2.5]) {
    const log = cylinder(`${name}_log`, 0.07, 0.07, 0.8, [x, z], mat('#3d2a17'), 6, 0.1)
    log.rotation.set(Math.PI / 2, 0, a)
    g.add(log)
  }
  g.add(cone(`${name}_flame`, 0.22, 0.5, [x, 0.4, z], mat('#ffb347', { emissive: '#ff6a00', emissiveIntensity: 2.5 }), 6))
  return [g, light(name, [x, 0.9, z], { flicker: 0.7, intensity: 90, color_temp: 1900 })]
}

// ------------------------------------------------------------------ scene & output

export function newScene(name, userData) {
  const s = new Scene()
  s.name = name
  s.userData = userData
  return s
}

export async function writeGlb(scene, file) {
  const exporter = new GLTFExporter()
  const glb = await exporter.parseAsync(scene, { binary: true })
  const out = resolve(SCENES_DIR, file)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(glb))
  console.log(`wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} kB)`)
  return glb.byteLength
}
