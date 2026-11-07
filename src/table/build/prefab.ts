/**
 * Prefabs ("slabs"): capture the props and walls inside a rectangle of the table, and stamp them
 * back anywhere with the footprint corner on a cell corner, turned in quarter turns. Pure.
 *
 * Capture snaps the rectangle outwards to whole cells, so a room built on the grid comes back on
 * the grid ("kit snapping"): pieces stamped side by side line up edge to edge.
 */
import type { Prefab, PrefabProp, PrefabWall, Prop, Wall } from '@/core/doc'
import type { GridSpec, Vec3 } from '@/core/geometry'
import { newId, type PrefabId, type PropId, type SceneId, type WallId } from '@/core/ids'
import { Euler, Quaternion, Vector3 } from 'three'
import type { Bounds2 } from '../grid'
import { clean } from './wallEdit'

/** Corner lattice of a square grid: cells are centred on origin + k * cellSize. */
function cornerOffset(grid: GridSpec): { x: number; z: number } {
  return { x: grid.origin.x + grid.cellSize / 2, z: grid.origin.z + grid.cellSize / 2 }
}

/** A rectangle from two corners, grown outwards to whole cells (unless the grid is 'none'). */
export function snapRectToCells(a: { x: number; z: number }, b: { x: number; z: number }, grid: GridSpec): Bounds2 {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x)
  const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z)
  if (grid.type === 'none') return { minX, minZ, maxX, maxZ }
  const s = grid.cellSize
  const o = cornerOffset(grid)
  const eps = 1e-6
  const lo = (v: number, off: number) => clean(Math.floor((v - off) / s + eps) * s + off)
  const hi = (v: number, off: number) => clean(Math.ceil((v - off) / s - eps) * s + off)
  const r = { minX: lo(minX, o.x), minZ: lo(minZ, o.z), maxX: hi(maxX, o.x), maxZ: hi(maxZ, o.z) }
  // A click without a drag still captures the cell under it.
  if (r.maxX - r.minX < s - eps) r.maxX = clean(r.minX + s)
  if (r.maxZ - r.minZ < s - eps) r.maxZ = clean(r.minZ + s)
  return r
}

const inside = (p: { x: number; z: number }, r: Bounds2, eps = 1e-6) =>
  p.x >= r.minX - eps && p.x <= r.maxX + eps && p.z >= r.minZ - eps && p.z <= r.maxZ + eps

/** Props whose position and walls whose both ends lie inside `rect`, relative to its minimum corner. */
export function capturePrefab(opts: {
  name: string
  rect: Bounds2
  cellSize: number
  props: readonly Prop[]
  walls: readonly Wall[]
  /** Floor height of the scene; prop heights are kept relative to it. */
  floorY?: number
  id?: PrefabId
  now?: number
}): Prefab {
  const { rect } = opts
  const rel = (p: { x: number; z: number }) => ({ x: clean(p.x - rect.minX), z: clean(p.z - rect.minZ) })
  const props: PrefabProp[] = opts.props.filter((p) => inside(p.position, rect)).map((p) => {
    // Authorship belongs to the placed copy, not the template: apply stamps it on each stamp.
    const { id: _id, scene: _scene, createdBy: _by, editedBy: _ed, ...rest } = p
    const r = rel(p.position)
    return { ...rest, position: { x: r.x, y: clean(p.position.y - (opts.floorY ?? 0)), z: r.z } }
  })
  const walls: PrefabWall[] = opts.walls.filter((w) => inside(w.a, rect) && inside(w.b, rect)).map((w) => {
    const out: PrefabWall = { a: rel(w.a), b: rel(w.b) }
    // Doors come back closed and unlocked, whatever state they were captured in.
    if (w.door) out.door = { open: false }
    return out
  })
  return {
    id: opts.id ?? newId<'PrefabId'>(),
    name: opts.name,
    size: { x: clean(rect.maxX - rect.minX), z: clean(rect.maxZ - rect.minZ) },
    cellSize: opts.cellSize,
    props,
    walls,
    createdAt: opts.now ?? Date.now(),
  }
}

/** Quarter turns normalised to 0..3. */
export const quarter = (turns: number): 0 | 1 | 2 | 3 => (((Math.round(turns) % 4) + 4) % 4) as 0 | 1 | 2 | 3

/** Footprint size after `turns` quarter turns, on a grid of `cellSize` (scaled from the capture grid). */
export function stampSize(prefab: Pick<Prefab, 'size' | 'cellSize'>, turns: number, cellSize: number): { x: number; z: number } {
  const k = prefab.cellSize > 0 ? cellSize / prefab.cellSize : 1
  const w = prefab.size.x * k, d = prefab.size.z * k
  return quarter(turns) % 2 ? { x: d, z: w } : { x: w, z: d }
}

/**
 * Minimum corner of a stamp centred on the pointer: the footprint's corner snaps to a cell corner
 * (kit snapping), or stays free on a 'none' grid / with `snap` off.
 */
export function stampCorner(pointer: { x: number; z: number }, size: { x: number; z: number }, grid: GridSpec, snap = true): { x: number; z: number } {
  const x = pointer.x - size.x / 2
  const z = pointer.z - size.z / 2
  if (!snap || grid.type === 'none') return { x: clean(x), z: clean(z) }
  const s = grid.cellSize
  const o = cornerOffset(grid)
  return { x: clean(Math.round((x - o.x) / s) * s + o.x), z: clean(Math.round((z - o.z) / s) * s + o.z) }
}

/**
 * Turn a point given relative to the footprint corner by `turns` quarter turns (clockwise seen
 * from above, matching a +Y rotation of the props) and keep it inside the turned footprint.
 * `w`/`d` are the unturned footprint size.
 */
function turnPoint(p: { x: number; z: number }, turns: 0 | 1 | 2 | 3, w: number, d: number): { x: number; z: number } {
  switch (turns) {
    case 0: return { x: p.x, z: p.z }
    // A +90° turn about Y maps (x, z) to (z, -x); shift so the footprint starts at 0 again.
    case 1: return { x: p.z, z: w - p.x }
    case 2: return { x: w - p.x, z: d - p.z }
    case 3: return { x: d - p.z, z: p.x }
  }
}

export interface StampResult {
  props: Prop[]
  walls: Wall[]
}

/** Concrete props and walls for a stamp with its footprint corner at `corner`. New ids every time. */
export function stampPrefab(
  prefab: Prefab,
  opts: { scene: SceneId; corner: { x: number; z: number }; turns: number; cellSize: number; floorY: number },
): StampResult {
  const turns = quarter(opts.turns)
  const k = prefab.cellSize > 0 ? opts.cellSize / prefab.cellSize : 1
  const w = prefab.size.x * k, d = prefab.size.z * k
  const place = (p: { x: number; z: number }) => {
    const t = turnPoint({ x: p.x * k, z: p.z * k }, turns, w, d)
    return { x: clean(opts.corner.x + t.x), z: clean(opts.corner.z + t.z) }
  }
  const angle = (turns * Math.PI) / 2
  const props: Prop[] = prefab.props.map(({ createdBy: _by, editedBy: _ed, ...p }) => {
    const at = place(p.position)
    const position: Vec3 = { x: at.x, y: clean(opts.floorY + p.position.y * k), z: at.z }
    return {
      ...p,
      id: newId<'PropId'>() as PropId,
      scene: opts.scene,
      position,
      rotation: turnRotation(p.rotation, angle),
      // A version 1 number stays a number (migrated when it loads); per-axis scales grow per axis.
      scale: typeof p.scale === 'number' ? clean(p.scale * k) : { x: clean(p.scale.x * k), y: clean(p.scale.y * k), z: clean(p.scale.z * k) },
    }
  })
  const walls: Wall[] = prefab.walls.map((pw) => {
    const wall: Wall = { id: newId<'WallId'>() as WallId, scene: opts.scene, a: place(pw.a), b: place(pw.b), source: 'prefab' }
    if (pw.door) wall.door = { open: false }
    return wall
  })
  return { props, walls }
}

/**
 * `rotation` (Euler XYZ) after a turn of `angle` about the world Y axis. An upright prop just adds
 * the angle to its Y; a tilted one composes the turn so the tilt turns with the stamp.
 */
export function turnRotation(rotation: Vec3, angle: number): Vec3 {
  if (Math.abs(rotation.x) < 1e-9 && Math.abs(rotation.z) < 1e-9) return { ...rotation, y: normalizeAngle(rotation.y + angle) }
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).multiply(new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z, 'XYZ')))
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  return { x: normalizeAngle(e.x), y: normalizeAngle(e.y), z: normalizeAngle(e.z) }
}

function normalizeAngle(r: number): number {
  const two = Math.PI * 2
  let v = ((r % two) + two) % two
  if (v > Math.PI) v -= two
  return Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6))
}

/** "3 props · 8 walls · 2 × 3 cells" for the prefab list. */
export function prefabSummary(prefab: Prefab): string {
  const cells = (v: number) => Math.round((v / (prefab.cellSize || 1)) * 10) / 10
  const parts: string[] = []
  if (prefab.props.length) parts.push(`${prefab.props.length} ${prefab.props.length === 1 ? 'prop' : 'props'}`)
  if (prefab.walls.length) parts.push(`${prefab.walls.length} ${prefab.walls.length === 1 ? 'wall' : 'walls'}`)
  if (!parts.length) parts.push('empty')
  parts.push(`${cells(prefab.size.x)} × ${cells(prefab.size.z)} cells`)
  return parts.join(' · ')
}
