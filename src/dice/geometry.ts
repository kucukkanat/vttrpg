/**
 * Die polyhedra: vertices, faces, face-normal → value mapping, texture-atlas UVs
 * and the symmetry rotations used to make a die show a required value.
 *
 * Pure three.js math (no DOM), so it is unit-tested with Vitest.
 *
 * Terminology
 *  - face:    a flat polygon of the mesh (the thing that gets a texture tile)
 *  - reading: a direction that, when pointing up, means the die shows `value`.
 *             For every die but the d4 a reading is a face normal. The d4 is read at the
 *             vertex pointing up, so its readings are vertex directions and each face tile
 *             prints three numbers, one near each corner, like a physical d4.
 */
import {
  BoxGeometry,
  BufferGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from 'three'

/** Die types we can render. `d100` is the tens die of a percentile pair (faces 00..90). */
export type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100'
export const DIE_TYPES: readonly DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']

export interface DieFace {
  /** Polyhedron vertex indices, counter-clockwise seen from outside. */
  vertices: number[]
  normal: Vector3
  center: Vector3
  /** Texture "up" direction on the face (unit, in the face plane). */
  up: Vector3
  /** Texture "right" direction (= up × normal). */
  right: Vector3
  /** Atlas tile index. */
  tile: number
}

export interface DieReading {
  /** 1-based die value this reading stands for. */
  value: number
  /** Unit direction in die space that points up when the die shows `value`. */
  normal: Vector3
}

export interface DieDef {
  type: DieType
  sides: number
  vertices: Vector3[]
  faces: DieFace[]
  readings: DieReading[]
  /** For the d4: readings[k] belongs to vertices[k]. */
  vertexReadings: boolean
  /** Distance from the centre to the face planes (for font sizing), after `scale`. */
  inradius: number
  /** Visual scale multiplier so all dice read about the same size. */
  scale: number
}

const UP = new Vector3(0, 1, 0)
const EPS = 1e-4

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/** Groups the coplanar triangles of a three geometry into polygon faces (tolerance-based). */
function facesFromGeometry(input: BufferGeometry): { vertices: Vector3[]; polygons: number[][] } {
  const geo = input.index ? input.toNonIndexed() : input
  const pos = geo.getAttribute('position')
  const vertices: Vector3[] = []
  const vid = (v: Vector3) => {
    const i = vertices.findIndex((w) => w.distanceToSquared(v) < 1e-8)
    if (i >= 0) return i
    vertices.push(v.clone())
    return vertices.length - 1
  }
  const groups: { normal: Vector3; ids: Set<number> }[] = []
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i)
    b.fromBufferAttribute(pos, i + 1)
    c.fromBufferAttribute(pos, i + 2)
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize()
    let g = groups.find((x) => x.normal.dot(n) > 1 - 1e-6)
    if (!g) groups.push((g = { normal: n.clone(), ids: new Set() }))
    g.ids.add(vid(a)); g.ids.add(vid(b)); g.ids.add(vid(c))
  }
  return { vertices, polygons: groups.map((g) => [...g.ids]) }
}

/** Orders a face's vertex indices counter-clockwise around its outward normal. */
function orderPolygon(vertices: Vector3[], ids: number[]): { ids: number[]; normal: Vector3; center: Vector3 } {
  const center = new Vector3()
  for (const i of ids) center.add(vertices[i])
  center.divideScalar(ids.length)
  // Provisional axis for ordering: the centroid direction (good enough for convex faces of
  // centred polyhedra). The exact normal comes from Newell's method on the ordered loop.
  const axis = center.clone().normalize()
  const t = vertices[ids[0]].clone().sub(center).normalize()
  const bt = new Vector3().crossVectors(axis, t)
  const sorted = [...ids].sort((i, j) => {
    const pi = vertices[i].clone().sub(center), pj = vertices[j].clone().sub(center)
    return Math.atan2(pi.dot(bt), pi.dot(t)) - Math.atan2(pj.dot(bt), pj.dot(t))
  })
  const normal = new Vector3()
  for (let k = 0; k < sorted.length; k++) {
    const p = vertices[sorted[k]], q = vertices[sorted[(k + 1) % sorted.length]]
    normal.x += (p.y - q.y) * (p.z + q.z)
    normal.y += (p.z - q.z) * (p.x + q.x)
    normal.z += (p.x - q.x) * (p.y + q.y)
  }
  normal.normalize()
  if (normal.dot(axis) < 0) { normal.negate(); sorted.reverse() }
  return { ids: sorted, normal, center }
}

/** Pentagonal trapezohedron (the d10). Circumradius 1 at the poles. */
function trapezohedron(): { vertices: Vector3[]; polygons: number[][] } {
  const h = 1
  const c36 = Math.cos(Math.PI / 5)
  const e = h * (1 - c36) / (1 + c36) // makes the kites planar
  const r = 1
  const vertices: Vector3[] = [new Vector3(0, h, 0), new Vector3(0, -h, 0)]
  // zigzag ring: even k high, odd k low, 36° apart
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5
    vertices.push(new Vector3(r * Math.cos(a), k % 2 === 0 ? e : -e, r * Math.sin(a)))
  }
  const ring = (k: number) => 2 + ((k + 10) % 10)
  const polygons: number[][] = []
  for (let k = 0; k < 10; k += 2) {
    polygons.push([0, ring(k), ring(k + 1), ring(k + 2)]) // top kite: pole, high, low, high
    polygons.push([1, ring(k + 1), ring(k + 2), ring(k + 3)]) // bottom kite: pole, low, high, low
  }
  return { vertices, polygons }
}

/**
 * Values: opposite faces sum to sides+1 (d10 pair: 1..10 with 10 printed as 0).
 * Faces are visited in a canonical order (sorted normals) so the assignment is stable.
 */
function assignValues(faces: { normal: Vector3 }[]): number[] {
  const n = faces.length
  const order = faces.map((_, i) => i).sort((i, j) => {
    const a = faces[i].normal, b = faces[j].normal
    return a.y !== b.y ? b.y - a.y : a.x !== b.x ? a.x - b.x : a.z - b.z
  })
  const values = new Array<number>(n).fill(0)
  let next = 1
  for (const i of order) {
    if (values[i]) continue
    values[i] = next
    const opp = faces.findIndex((f) => f.normal.dot(faces[i].normal) < -1 + 1e-3)
    if (opp >= 0 && !values[opp]) values[opp] = n + 1 - next
    next++
    while (values.includes(next) && next <= n) next++
  }
  return values
}

const SCALES: Record<DieType, number> = { d4: 1.25, d6: 1.12, d8: 1.05, d10: 1.0, d12: 0.95, d20: 0.95, d100: 1.0 }

function build(type: DieType): DieDef {
  let raw: { vertices: Vector3[]; polygons: number[][] }
  switch (type) {
    case 'd4': raw = facesFromGeometry(new TetrahedronGeometry(1)); break
    case 'd6': raw = facesFromGeometry(new BoxGeometry(2 / Math.sqrt(3), 2 / Math.sqrt(3), 2 / Math.sqrt(3))); break
    case 'd8': raw = facesFromGeometry(new OctahedronGeometry(1)); break
    case 'd10': case 'd100': raw = trapezohedron(); break
    case 'd12': raw = facesFromGeometry(new DodecahedronGeometry(1)); break
    case 'd20': raw = facesFromGeometry(new IcosahedronGeometry(1)); break
  }
  const scale = SCALES[type]
  const vertices = raw.vertices.map((v) => v.clone().multiplyScalar(scale))
  const ordered = raw.polygons.map((p) => orderPolygon(vertices, p))
  const vertexReadings = type === 'd4'

  let readings: DieReading[]
  if (vertexReadings) {
    readings = vertices.map((v, k) => ({ value: k + 1, normal: v.clone().normalize() }))
  } else {
    const values = assignValues(ordered)
    readings = ordered.map((f, i) => ({ value: values[i], normal: f.normal.clone() }))
  }

  const faces: DieFace[] = ordered.map((f, tile) => {
    const { ids, normal, center } = f
    let up: Vector3
    if (ids.length === 4 && type !== 'd6') {
      // kite: the pole vertex is the one farthest from the equator
      const apex = ids.reduce((best, i) => (Math.abs(vertices[i].y) > Math.abs(vertices[best].y) ? i : best), ids[0])
      up = vertices[apex].clone().sub(center).normalize()
    } else if (ids.length === 4) {
      up = vertices[ids[0]].clone().add(vertices[ids[1]]).multiplyScalar(0.5).sub(center).normalize()
    } else {
      up = vertices[ids[0]].clone().sub(center).normalize()
    }
    const right = new Vector3().crossVectors(up, normal).normalize()
    return { vertices: ids, normal, center, up, right, tile }
  })

  const inradius = Math.min(...faces.map((f) => f.center.dot(f.normal)))
  return { type, sides: type === 'd100' ? 10 : Number(type.slice(1)), vertices, faces, readings, vertexReadings, inradius, scale }
}

const cache = new Map<DieType, DieDef>()
export function dieDef(type: DieType): DieDef {
  let d = cache.get(type)
  if (!d) cache.set(type, (d = build(type)))
  return d
}

/* -------------------------------------------------------------------------- */
/* Reading faces                                                              */
/* -------------------------------------------------------------------------- */

/** Index into `def.readings` of the reading closest to pointing up for a die rotated by `q`. */
export function upReading(def: DieDef, q: Quaternion): number {
  let best = 0, bestDot = -Infinity
  const n = new Vector3()
  def.readings.forEach((r, i) => {
    const d = n.copy(r.normal).applyQuaternion(q).dot(UP)
    if (d > bestDot) { bestDot = d; best = i }
  })
  return best
}

/** How flat the die rests: cosine between the up reading and +Y (1 = perfectly flat). */
export function upFlatness(def: DieDef, q: Quaternion): number {
  const r = def.readings[upReading(def, q)]
  return r.normal.clone().applyQuaternion(q).dot(UP)
}

export function readingForValue(def: DieDef, value: number): number {
  const i = def.readings.findIndex((r) => r.value === value)
  if (i < 0) throw new Error(`${def.type} has no face for ${value}`)
  return i
}

/* -------------------------------------------------------------------------- */
/* Symmetries                                                                 */
/* -------------------------------------------------------------------------- */

function frameRotation(nA: Vector3, tA: Vector3, nB: Vector3, tB: Vector3): Quaternion {
  const mA = new Matrix4().makeBasis(nA, tA, new Vector3().crossVectors(nA, tA))
  const mB = new Matrix4().makeBasis(nB, tB, new Vector3().crossVectors(nB, tB))
  // R = B · Aᵀ
  const r = mB.multiply(mA.clone().transpose())
  return new Quaternion().setFromRotationMatrix(r).normalize()
}

/** True when `q` maps the vertex set of the die onto itself (i.e. is a symmetry of the shape). */
export function isSymmetry(def: DieDef, q: Quaternion, eps = 1e-3): boolean {
  const p = new Vector3()
  return def.vertices.every((v) => {
    p.copy(v).applyQuaternion(q)
    return def.vertices.some((w) => w.distanceToSquared(p) < eps * eps)
  })
}

/** Vertices that can serve as tangent references for a reading: the nearest ring around its normal. */
function tangentRefs(def: DieDef, n: Vector3): Vector3[] {
  const perp = def.vertices
    .map((v) => ({ dot: v.dot(n), t: v.clone().addScaledVector(n, -v.dot(n)) }))
    .filter((x) => x.t.lengthSq() > EPS)
  const top = Math.max(...perp.map((x) => x.dot))
  return perp.filter((x) => x.dot > top - 1e-3).map((x) => x.t.normalize())
}

/**
 * The rotation symmetry of the die that carries reading `from` onto reading `to`.
 * Applying it to the visual mesh (relative to its rigid body) shows `to`'s value wherever
 * the body would have shown `from`'s, while the visible shape stays exactly on the collider.
 * Among valid symmetries, the smallest rotation is returned.
 */
export function symmetryRotation(def: DieDef, from: number, to: number): Quaternion {
  if (from === to) return new Quaternion()
  const nA = def.readings[from].normal, nB = def.readings[to].normal
  const refsA = tangentRefs(def, nA), refsB = tangentRefs(def, nB)
  let best: Quaternion | null = null, bestAngle = Infinity
  const tA = refsA[0]
  for (const tB of refsB) {
    const q = frameRotation(nA, tA, nB, tB)
    if (!isSymmetry(def, q)) continue
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)))
    if (angle < bestAngle) { bestAngle = angle; best = q }
  }
  if (!best) throw new Error(`no symmetry of ${def.type} maps reading ${from} to ${to}`)
  return best
}

/* -------------------------------------------------------------------------- */
/* Labels and atlas layout                                                    */
/* -------------------------------------------------------------------------- */

/** What is printed for a reading value: d10 prints 10 as "0", the tens die prints 00..90. */
export function faceLabel(type: DieType, value: number): string {
  if (type === 'd10') return String(value % 10)
  if (type === 'd100') return `${value % 10}0`
  return String(value)
}

export function atlasGrid(tiles: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(tiles))
  return { cols, rows: Math.ceil(tiles / cols) }
}

/** Tile-local 2D coordinates (x right, y up, tile spans [-0.5, 0.5]²) of a face's polygon. */
export function faceTilePolygon(def: DieDef, face: DieFace, margin = 0.06): { x: number; y: number }[] {
  const pts = face.vertices.map((i) => {
    const d = def.vertices[i].clone().sub(face.center)
    return { x: d.dot(face.right), y: d.dot(face.up) }
  })
  const extent = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
  const s = (0.5 - margin) / extent
  return pts.map((p) => ({ x: p.x * s, y: p.y * s }))
}

/** Renderable geometry: flat-shaded, one UV tile per face. */
export function buildDieGeometry(def: DieDef): BufferGeometry {
  const { cols, rows } = atlasGrid(def.faces.length)
  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  for (const face of def.faces) {
    const poly = faceTilePolygon(def, face)
    const col = face.tile % cols, row = Math.floor(face.tile / cols)
    const uv = (p: { x: number; y: number }) => [(col + 0.5 + p.x) / cols, 1 - (row + 0.5 - p.y) / rows]
    for (let k = 1; k < face.vertices.length - 1; k++) {
      for (const idx of [0, k, k + 1]) {
        const v = def.vertices[face.vertices[idx]]
        positions.push(v.x, v.y, v.z)
        normals.push(face.normal.x, face.normal.y, face.normal.z)
        uvs.push(...uv(poly[idx]))
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geo
}

/** Flat Float32Array of the vertices, for Rapier's convex hull. */
export function hullPoints(def: DieDef, scale = 1): Float32Array {
  const out = new Float32Array(def.vertices.length * 3)
  def.vertices.forEach((v, i) => { out[i * 3] = v.x * scale; out[i * 3 + 1] = v.y * scale; out[i * 3 + 2] = v.z * scale })
  return out
}

/* -------------------------------------------------------------------------- */
/* Formula dice → physical dice                                               */
/* -------------------------------------------------------------------------- */

export interface PhysicalDie {
  type: DieType
  /** 1-based value in `dieDef(type).readings`. */
  value: number
  /** Index of the originating `dice` entry. */
  source: number
}

/**
 * Maps rolled dice onto physical dice. A d100 becomes a tens die plus a units d10.
 * Unsupported side counts are dropped (the result still stands; only the animation is missing).
 */
export function toPhysicalDice(dice: { sides: number; value: number }[]): PhysicalDie[] {
  const out: PhysicalDie[] = []
  dice.forEach((d, source) => {
    if (d.sides === 100) {
      const units = d.value % 10
      const tens = ((d.value - units) / 10) % 10
      out.push({ type: 'd100', value: tens === 0 ? 10 : tens, source })
      out.push({ type: 'd10', value: units === 0 ? 10 : units, source })
      return
    }
    const type = `d${d.sides}` as DieType
    if (!DIE_TYPES.includes(type) || type === 'd100') return
    out.push({ type, value: d.value, source })
  })
  return out
}
