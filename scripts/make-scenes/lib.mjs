/**
 * Shared helpers for the generated starter scenes and library models. Every scene follows the
 * Blender naming convention documented in public/library/scenes/README.md:
 *
 *   COL_*   meshes  -> colliders / line-of-sight walls (hidden after load)
 *   WALL_*  meshes  -> visible walls, faded when viewed from above (<= 0.3 m thick)
 *   LIGHT_* nodes   -> a holder node with `flicker` / `color_temp` userData and a PointLight child
 *   SPAWN_* empties -> token spawn points
 *   GRID    empty   -> grid origin; userData `cell_size`, `type`
 *   FOG_*   meshes  -> regions that start hidden
 *   scene userData `ambient_audio`, `ambient_preset`
 *
 * Units are metres, +Y is up, the floor is at y = 0. No textures anywhere.
 *
 * The look is a candle-lit miniature diorama: flat colour with the lighting cues baked in. Right
 * before export, `bakeDiorama` gives every visible, non-emissive, non-helper mesh a COLOR_0
 * (normalized Uint8 RGBA) made of its base colour times a height gradient (darker low, slightly
 * lighter high), a contact shadow near the floor and a cheap neighbour occlusion term (vertices
 * inside or near another mesh's bounding box). Those meshes then share ONE material named
 * `diorama` (white, vertex colours, rough, non-metal) and the root gets `userData.style =
 * 'diorama'`, so the table can swap in its own stylised material. Emissive meshes (flames,
 * embers, glowing eyes, orbs) keep their own material and get no vertex colours; COL_ / FOG_
 * helpers keep theirs. `uv` attributes are dropped since nothing is textured.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Box3, BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, Mesh,
  MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Scene, SphereGeometry, Vector3,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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

// ------------------------------------------------------------------ palette

/**
 * Shared colours (sRGB hex). Scenery sits in muted mid values so tokens read on top of it; the
 * saturated accents are kept for minis, banners and small details.
 */
export const palette = {
  // wood and leather
  oak: '#7a5a36', darkOak: '#5a3f24', pine: '#a07c4a', timber: '#4a3620', planks: '#6b4e2e',
  bark: '#4a3320', barkLight: '#6b4a2e', charred: '#3d2a17', leather: '#4a2e14', tan: '#8d6e4a',
  counterTop: '#8a6a3e',
  // stone and earth
  stone: '#6f6a63', stoneLight: '#8c877f', rock: '#5b5650', flagstone: '#444039', soot: '#3c3833',
  altar: '#3a3630', rubble: '#4a4640', rubbleLight: '#75706a', boulder: '#56585a', boulderLight: '#8d9196',
  pebble: '#6a6c70', dirt: '#6b5637', plaster: '#b8a98a', trim: '#8a7b5a', devFloor: '#4b4740',
  // foliage
  leaf: '#2d5a27', leafDark: '#27502a', leafLight: '#4f8a3a',
  // cloth and metal
  linen: '#d9cdb4', wool: '#8c3b3b', iron: '#3b3d42', steel: '#9aa3ad', steelDark: '#5d666f', brass: '#b08a3c',
  bone: '#ddd2b6', boneShadow: '#a89c80',
  // fur and skin
  mouseFur: '#b89a78', ratFur: '#6b625a', ratBelly: '#8d847a', ratTail: '#a08478', pink: '#e0a8a0',
  goblinSkin: '#6f9a3c', goblinDark: '#4f7428', skin: '#d9a27a', beard: '#cfc8bc', ink: '#1a1612',
  // saturated accents for minis
  red: '#c23b2a', blue: '#2f4f8c', green: '#3f6b4a', gold: '#d9a441', purple: '#5b3f8c', teal: '#2f8a86',
  rust: '#8c5a2a', bottleGreen: '#4d7a3a', bottleRed: '#7a3a3a', bottleBlue: '#3a5a7a', bottleAmber: '#c9a35a',
  // light sources (emissive, keep their own material)
  flame: '#ffb347', flameCore: '#ff6a00', ember: '#ff7a1a', emberCore: '#ff3c00',
  arcane: '#9fd8ff', arcaneCore: '#3fa8ff', brew: '#9be05a', brewCore: '#3f9a12', eyeGlow: '#5a0f08',
  // helpers (never rendered)
  helper: '#555555', fog: '#222233',
}

// ------------------------------------------------------------------ materials

const materials = new Map()
/**
 * Flat material per colour. Non-emissive ones only carry the base colour into `bakeDiorama`,
 * which folds it into vertex colours; emissive ones are exported as they are.
 */
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

/** Emissive material for a light source (flame, ember, orb). */
export const glow = (color, emissive, emissiveIntensity = 2) => mat(color, { emissive, emissiveIntensity })

let dioramaMat = null
/**
 * The one material every baked mesh ends up with: white, reading the baked vertex colours. Also
 * what organic props (trees, rocks) use directly with `paint()`ed geometry.
 */
export function dioramaMaterial() {
  if (!dioramaMat) {
    dioramaMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
    dioramaMat.name = 'diorama'
  }
  return dioramaMat
}
export const vertexMaterial = dioramaMaterial

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

// ------------------------------------------------------------------ baked diorama look

const HELPER = /^(COL|FOG)_/
/** Height gradient: factor at the floor and at `span` metres (scenes) or the model's top (props). */
const GRADIENT_LOW = 0.8
const GRADIENT_HIGH = 1.05
const SCENE_GRADIENT_SPAN = 2.5
/** Contact shadow: factor at y = 0, fading to 1 over `CONTACT_RANGE` metres. */
const CONTACT_LOW = 0.55
const CONTACT_RANGE = 0.3
/** Neighbour occlusion: factor inside another mesh's box, fading to 1 at `margin` outside it. */
const NEIGHBOUR_AO = 0.78

const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x) }

function isEmissive(material) {
  const e = material.emissive
  return !!e && material.emissiveIntensity > 0 && e.r + e.g + e.b > 0
}

/** Flat, floor-level mesh (floors, paths): gets no contact shadow and occludes nothing. */
function isGround(box) {
  return box.max.y - box.min.y < 0.05 && box.max.y < 0.1
}

/**
 * Bakes the diorama shading into vertex colours and swaps every eligible mesh to the shared
 * `diorama` material (see the header). `height` switches from the scene gradient (world y over
 * 2.5 m) to a gradient over the model's own height, for props and minis.
 */
export function bakeDiorama(root, { height } = {}) {
  root.updateMatrixWorld(true)
  const shared = dioramaMaterial()
  const span = height ? Math.max(0.2, height) : SCENE_GRADIENT_SPAN
  const contact = height ? Math.min(CONTACT_RANGE, height * 0.3) : CONTACT_RANGE
  const margin = height ? 0.03 : 0.05

  const targets = []
  const users = new Map()
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    o.geometry.deleteAttribute('uv')
    if (!o.visible || HELPER.test(o.name) || Array.isArray(o.material) || isEmissive(o.material)) return
    const box = new Box3().setFromObject(o, true)
    targets.push({ mesh: o, box, ground: isGround(box) })
    users.set(o.geometry, (users.get(o.geometry) ?? 0) + 1)
  })
  const occluders = targets.filter((t) => !t.ground).map((t) => ({ mesh: t.mesh, box: t.box.clone().expandByScalar(margin) }))

  const done = new Set()
  const p = new Vector3()
  const base = new Color()
  const tint = new Color()
  const painted = new Color()
  for (const { mesh, box, ground } of targets) {
    const geo = mesh.geometry
    if (done.has(geo)) { mesh.material = shared; continue }
    done.add(geo)
    // Geometry shared between instances (trees) is baked from its first instance, without the
    // neighbour term, which would differ per instance.
    const isShared = users.get(geo) > 1
    const near = isShared ? [] : occluders.filter((o) => o.mesh !== mesh && o.box.intersectsBox(box))
    const src = mesh.material
    const vertexColors = src.vertexColors ? geo.getAttribute('color') : undefined
    tint.copy(src.color ?? new Color(1, 1, 1))
    const pos = geo.getAttribute('position')
    const out = new Uint8Array(pos.count * 4)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      base.copy(tint)
      if (vertexColors) base.multiply(painted.setRGB(vertexColors.getX(i), vertexColors.getY(i), vertexColors.getZ(i)))
      let f = GRADIENT_LOW + (GRADIENT_HIGH - GRADIENT_LOW) * Math.min(1, Math.max(0, p.y / span))
      if (!ground) f *= CONTACT_LOW + (1 - CONTACT_LOW) * smooth(p.y / contact)
      let ao = 1
      for (const o of near) {
        const { min, max } = o.box
        const dx = Math.max(min.x - p.x, 0, p.x - max.x)
        const dy = Math.max(min.y - p.y, 0, p.y - max.y)
        const dz = Math.max(min.z - p.z, 0, p.z - max.z)
        if (dx > 0 || dy > 0 || dz > 0) continue // outside the expanded box
        // Inside the expanded box: full occlusion inside the real box, fading out over the margin.
        const ix = Math.max(min.x + margin - p.x, 0, p.x - (max.x - margin))
        const iy = Math.max(min.y + margin - p.y, 0, p.y - (max.y - margin))
        const iz = Math.max(min.z + margin - p.z, 0, p.z - (max.z - margin))
        const d = Math.hypot(ix, iy, iz)
        ao = Math.min(ao, NEIGHBOUR_AO + (1 - NEIGHBOUR_AO) * Math.min(1, d / margin))
      }
      f *= ao
      out[i * 4] = Math.round(Math.min(1, Math.max(0, base.r * f)) * 255)
      out[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, base.g * f)) * 255)
      out[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, base.b * f)) * 255)
      out[i * 4 + 3] = 255
    }
    geo.setAttribute('color', new BufferAttribute(out, 4, true))
    mesh.material = shared
  }
  root.userData = { ...root.userData, style: 'diorama' }
  return root
}

/**
 * Folds every mesh under `parent` that carries the shared `diorama` material into one mesh named
 * `name` (default `<parent>_model`), a child of `parent`. Run after `bakeDiorama`: the neighbour
 * term needs the parts separate. One draw call and one accessor set per model instead of dozens;
 * emissive parts, helpers and lights stay where they are. Groups left empty are dropped.
 */
export function mergeDiorama(parent, name = `${parent.name}_model`) {
  parent.updateMatrixWorld(true)
  const toParent = parent.matrixWorld.clone().invert()
  const shared = dioramaMaterial()
  const parts = []
  parent.traverse((o) => { if (o instanceof Mesh && o.material === shared && !HELPER.test(o.name)) parts.push(o) })
  if (parts.length < 2) return parent
  const geos = parts.map((m) => {
    const g = m.geometry.clone().applyMatrix4(toParent.clone().multiply(m.matrixWorld))
    if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()])
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(key)) g.deleteAttribute(key)
    return g
  })
  const merged = mergeGeometries(geos, false)
  if (!merged) throw new Error(`${name}: parts do not share the same attributes, cannot merge`)
  for (const m of parts) m.removeFromParent()
  const prune = (o) => {
    for (const c of [...o.children]) prune(c)
    if (o !== parent && o.type === 'Group' && o.children.length === 0) o.removeFromParent()
  }
  prune(parent)
  const mesh = new Mesh(merged, shared)
  mesh.name = name
  parent.add(mesh)
  return parent
}

/**
 * Bakes the diorama look into `root` and returns it as a binary glTF ArrayBuffer. `merge` lists
 * objects under `root` whose baked parts are folded into one mesh each (see `mergeDiorama`); only
 * use it for dressing whose individual part names nothing relies on.
 */
export async function exportDiorama(root, { merge = [], ...bake } = {}) {
  bakeDiorama(root, bake)
  for (const o of [merge].flat()) mergeDiorama(o)
  return new GLTFExporter().parseAsync(root, { binary: true })
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

/** Plane split into roughly `step`-metre squares so the baked contact shadows have vertices to land on. */
export function planeGeometry(w, d, step = 0.6) {
  return new PlaneGeometry(w, d, Math.max(1, Math.ceil(w / step)), Math.max(1, Math.ceil(d / step)))
}

export function floor(name, w, d, material, [x = 0, z = 0] = [], y = 0) {
  const m = new Mesh(planeGeometry(w, d), material)
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
  return block(`COL_${name}`, [w, h, d], [x, z], mat(palette.helper), rotY)
}

/** Thin collider slab under the whole floor so the loader has a floor to raycast. */
export function floorCollider(w, d, [x = 0, z = 0] = []) {
  return box('COL_floor', [w, 0.1, d], [x, -0.05, z], mat(palette.helper))
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
  return box(name, [w, 0.1, d], [x, 0.05, z], mat(palette.fog))
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
  const stick = cylinder(`${name}_stick`, 0.03, 0.04, 0.4, [0, 0], mat(palette.timber), 6, 0)
  stick.position.set(x, y - 0.25, z)
  const flame = sphere(`${name}_flame`, 0.09, [x, y, z], glow(palette.flame, palette.ember, 2), 6)
  g.add(stick, flame)
  return [g, light(name, [x, y + 0.1, z], { flicker, intensity, color_temp: 2000 })]
}

/** Four-legged table with two benches along its long sides. Returns a group plus one collider. */
export function tableWithBenches(name, [x, z], { w = 2.2, d = 1.0, rotY = 0 } = {}) {
  const wood = mat(palette.oak)
  const dark = mat(palette.darkOak)
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
  const col = block(`COL_${name}`, [w, 0.8, d], [x, z], mat(palette.helper), rotY)
  return [g, col]
}

/**
 * Low-poly tree: trunk cylinder (also the collider) plus two cone canopies. Geometry is shared per
 * tint and scaled per tree so a forest of them stays small on disk; the bake shades it once, from
 * the first tree that uses it.
 */
const treeGeos = new Map()
function treeGeometry(tint, top) {
  let g = treeGeos.get(tint)
  if (!g) {
    g = {
      trunk: paint(new CylinderGeometry(0.7, 1, 1, 7), palette.bark, palette.barkLight),
      canopy: paint(new ConeGeometry(1, 1, 8), tint, top),
      col: new CylinderGeometry(1, 1, 1, 6),
    }
    treeGeos.set(tint, g)
  }
  return g
}
export function tree(name, [x, z], { height = 5, trunkR = 0.25, canopyR = 1.6, tint = palette.leaf, top = palette.leafLight } = {}) {
  const vm = dioramaMaterial()
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
  const col = new Mesh(geo.col, mat(palette.helper))
  col.name = `COL_${name}`
  col.position.set(x, trunkH / 2, z)
  col.scale.set(trunkR, trunkH, trunkR)
  return [group(name, trunk, c1, c2), col]
}

/** Boulder: a squashed dodecahedron with vertex colours plus a collider. */
export function boulder(name, [x, z], r = 0.7, rotY = 0) {
  const geo = paint(new DodecahedronGeometry(r, 0), palette.boulder, palette.boulderLight)
  geo.scale(1, 0.65, 1)
  const m = new Mesh(geo, dioramaMaterial())
  m.name = name
  m.position.set(x, r * 0.45, z)
  m.rotation.y = rotY
  const col = cylinder(`COL_${name}`, r * 0.9, r * 0.9, r, [x, z], mat(palette.helper), 6)
  return [m, col]
}

/** Campfire: a stone ring, logs, a flame and a flickering LIGHT_. */
export function campfire(name, [x, z]) {
  const g = new Group()
  g.name = `${name}_prop`
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const s = sphere(`${name}_stone`, 0.14, [x + Math.cos(a) * 0.55, 0.08, z + Math.sin(a) * 0.55], mat(palette.pebble), 5)
    s.scale.y = 0.6
    g.add(s)
  }
  for (const a of [0.3, 1.4, 2.5]) {
    const log = cylinder(`${name}_log`, 0.07, 0.07, 0.8, [x, z], mat(palette.charred), 6, 0.1)
    log.rotation.set(Math.PI / 2, 0, a)
    g.add(log)
  }
  g.add(cone(`${name}_flame`, 0.22, 0.5, [x, 0.4, z], glow(palette.flame, palette.flameCore, 2.5), 6))
  return [g, light(name, [x, 0.9, z], { flicker: 0.7, intensity: 90, color_temp: 1900 })]
}

// ------------------------------------------------------------------ scene & output

export function newScene(name, userData) {
  const s = new Scene()
  s.name = name
  s.userData = userData
  return s
}

export async function writeGlb(scene, file, { merge } = {}) {
  const glb = await exportDiorama(scene, { merge })
  const out = resolve(SCENES_DIR, file)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(glb))
  console.log(`wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} kB)`)
  return glb.byteLength
}
