/**
 * Pick-up-and-stamp maths (reports/Level design plan.md, Phase 1 item 4): where the held model's
 * ghost rests, how it snaps and turns, the scatter roll, and the prop a click places. Pure: no
 * three.js, no React, so the placement layer and the tests share it.
 */
import type { AssetRef } from '@/core/assets'
import type { Prop } from '@/core/doc'
import type { GridSpec, Vec3 } from '@/core/geometry'
import type { PlayerPubkey, PropId, SceneId } from '@/core/ids'

/** R or one wheel notch: 15°. Shift: 90°. */
export const TURN_STEP = Math.PI / 12
export const TURN_STEP_BIG = Math.PI / 2
/** Snap sizes offered in the tray, in cells (0 = free). Half a cell is the default. */
export const SNAP_CHOICES = [0, 0.25, 0.5, 1] as const
export const DEFAULT_SNAP_CELLS = 0.5
/** Scatter: ±15% scale by default; the tray offers up to ±50%. */
export const DEFAULT_SCATTER_RANGE = 0.15
export const MAX_SCATTER_RANGE = 0.5
/** A face counts as something to stand on when its normal points this much upward. */
const UP_FACING = 0.5

const TAU = Math.PI * 2

/** What a click places: a model, its catalogue id when known, and the tilt / scale it keeps. */
export interface HeldModel {
  /** `CatalogueEntry.id`; absent for a prop eyedropped from before the catalogue existed. */
  catalogue?: string
  title: string
  model: AssetRef
  /** Real size in metres [x, y, z] when the catalogue knows it (the footprint under the ghost). */
  size?: [number, number, number]
  /** Tilt kept from an eyedropped prop; the yaw is held separately so R can turn it. */
  tilt?: { x: number; z: number }
  /** Per-axis scale on the real size: {1,1,1} from a card, the prop's own from the eyedropper. */
  scale: Vec3
}

/** One scatter roll: the extra yaw and the uniform scale factor of the next stamp. */
export interface ScatterRoll {
  yaw: number
  scale: number
}

export const NO_SCATTER: ScatterRoll = Object.freeze({ yaw: 0, scale: 1 }) as ScatterRoll

/** Wraps an angle into [0, 2π). */
export function wrapAngle(a: number): number {
  const r = a % TAU
  return r < 0 ? r + TAU : r
}

/**
 * Turns the held model one step: 15°, or 90° with `big`. The result lands on a multiple of the
 * step, so an eyedropped odd angle joins the grid of turns on the first press.
 */
export function turnHeld(yaw: number, dir: 1 | -1, big = false): number {
  const step = big ? TURN_STEP_BIG : TURN_STEP
  const k = yaw / step
  const onStep = Math.abs(k - Math.round(k)) < 1e-6
  const next = onStep ? Math.round(k) + dir : dir > 0 ? Math.ceil(k) : Math.floor(k)
  return wrapAngle(next * step)
}

/** Degrees for the hint label (0–359). */
export function yawDegrees(yaw: number): number {
  return Math.round((wrapAngle(yaw) * 180) / Math.PI) % 360
}

/**
 * The ghost's floor position: the cursor snapped to `stepCells` of the grid (half a cell by
 * default, measured from the grid origin, so centres and corners both land), or free with Alt or
 * a step of 0. A grid of type `none` has no lines to snap to.
 */
export function snapPlacement(p: { x: number; z: number }, grid: Pick<GridSpec, 'cellSize' | 'origin' | 'type'>, stepCells: number, free = false): { x: number; z: number } {
  if (free || stepCells <= 0 || grid.type === 'none') return { x: p.x, z: p.z }
  const step = grid.cellSize * stepCells
  const snap = (v: number, o: number) => Math.round((v - o) / step) * step + o
  return { x: snap(p.x, grid.origin.x), z: snap(p.z, grid.origin.z) }
}

/** One ray hit under the cursor, nearest first: its height, how upward its face is, what it is. */
export interface SurfaceHit {
  /** Distance along the ray (the list is sorted on it before picking). */
  distance: number
  /** World height of the hit point. */
  y: number
  /** World-space normal's y (1 = a flat top). */
  normalY: number
  /** The prop hit, with its name for the hint. */
  propId?: string
  label?: string
}

export interface Surface {
  y: number
  /** "Table" or "floor", for the "on: …" hint. */
  on: string
  propId?: string
}

/**
 * What the ghost rests on: the nearest upward-facing hit (a table top, a crate lid), skipping the
 * sides of things, or the floor when nothing is under the cursor. Hits below the floor (a cellar
 * seen through a hole) never pull the ghost under it.
 */
export function pickSurface(hits: readonly SurfaceHit[], floorY: number): Surface {
  const sorted = [...hits].sort((a, b) => a.distance - b.distance)
  for (const h of sorted) {
    if (h.normalY < UP_FACING || h.y < floorY - 1e-3) continue
    return { y: h.y, on: h.label?.trim() || 'a model', ...(h.propId ? { propId: h.propId } : {}) }
  }
  return { y: floorY, on: 'floor' }
}

/** Small seeded RNG (mulberry32) so scatter tests are repeatable; returns [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A scatter roll: any yaw, and a uniform scale within ±`range` (clamped to 0…`MAX_SCATTER_RANGE`). */
export function rollScatter(random: () => number, range = DEFAULT_SCATTER_RANGE): ScatterRoll {
  const r = Math.max(0, Math.min(MAX_SCATTER_RANGE, range))
  return { yaw: random() * TAU, scale: 1 - r + random() * 2 * r }
}

/**
 * The prop one click places: the held model at `at` (the surface height under the snapped
 * cursor), turned by the held yaw plus any scatter yaw, scaled by the held scale times the scatter
 * factor, named after the catalogue title, with its catalogue id and who placed it.
 */
export function placedProp(args: {
  id: PropId
  scene: SceneId
  held: HeldModel
  at: Vec3
  yaw: number
  scatter?: ScatterRoll
  createdBy?: PlayerPubkey
}): Prop {
  const { id, scene, held, at, yaw, createdBy } = args
  const s = args.scatter ?? NO_SCATTER
  const k = s.scale
  const prop: Prop = {
    id,
    scene,
    name: held.title,
    model: held.model,
    position: { x: at.x, y: at.y, z: at.z },
    rotation: { x: held.tilt?.x ?? 0, y: wrapAngle(yaw + s.yaw), z: held.tilt?.z ?? 0 },
    scale: { x: held.scale.x * k, y: held.scale.y * k, z: held.scale.z * k },
  }
  if (held.catalogue) prop.catalogue = held.catalogue
  if (createdBy) prop.createdBy = createdBy
  return prop
}
