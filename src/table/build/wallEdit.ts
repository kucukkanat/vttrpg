/**
 * Drawn walls and doors: which segments block, snapping a pen point, picking walls near a point
 * and whether a move crosses a wall. Pure; no three.js, so the controller and tests can use it.
 */
import type { Scene, Wall } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { SceneId, WallId } from '@/core/ids'
import { hasLineOfSight, type Pt2, type WallSegment } from '../segments'

/** The drawn walls of one scene. */
export function sceneWalls(walls: Readonly<Record<string, Wall>>, scene: SceneId): Wall[] {
  return Object.values(walls).filter((w) => w.scene === scene)
}

/** Segments that block sight and movement: every wall, and doors while they are closed. */
export function blockingSegments(walls: readonly Wall[]): WallSegment[] {
  return walls.filter((w) => !w.door || !w.door.open).map((w) => ({ a: w.a, b: w.b }))
}

/** Everything the document knows blocks in a scene: imported walls plus drawn walls and closed doors. */
export function docBlockingSegments(scene: Pick<Scene, 'walls'> | undefined, walls: readonly Wall[]): WallSegment[] {
  return [...(scene?.walls ?? []), ...blockingSegments(walls)]
}

/** True when the straight move from `from` to `to` crosses a blocking segment. */
export function moveBlocked(from: Pt2, to: Pt2, segments: readonly WallSegment[]): boolean {
  if (Math.abs(from.x - to.x) < 1e-9 && Math.abs(from.z - to.z) < 1e-9) return false
  return !hasLineOfSight(from, to, segments)
}

/** Distance from `p` to the segment a-b. */
export function pointSegmentDistance(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x, dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

/** Indices of segments within `radius` of `p`. */
export function segmentsNear(p: Pt2, segments: readonly WallSegment[], radius: number): number[] {
  const out: number[] = []
  segments.forEach((s, i) => { if (pointSegmentDistance(p, s.a, s.b) <= radius) out.push(i) })
  return out
}

/** Ids of drawn walls within `radius` of `p`. */
export function wallsNear(p: Pt2, walls: readonly Wall[], radius: number): WallId[] {
  return walls.filter((w) => pointSegmentDistance(p, w.a, w.b) <= radius).map((w) => w.id)
}

/**
 * Where a wall pen lands. An existing wall end within `endpointRadius` wins, so walls join up into
 * rooms; otherwise the point snaps to the half-cell lattice (cell corners, edge midpoints and
 * centres of a square grid). `snap: false` (or a 'none' grid without endpoints near) keeps it free.
 */
export function snapWallPoint(
  p: Pt2,
  grid: GridSpec,
  endpoints: readonly Pt2[],
  opts: { snap?: boolean; endpointRadius?: number } = {},
): Pt2 {
  const radius = opts.endpointRadius ?? grid.cellSize * 0.3
  let best: Pt2 | null = null
  let bestD = radius
  for (const e of endpoints) {
    const d = Math.hypot(e.x - p.x, e.z - p.z)
    if (d <= bestD) { best = e; bestD = d }
  }
  if (best) return { x: best.x, z: best.z }
  if (opts.snap === false || grid.type === 'none') return { x: p.x, z: p.z }
  const step = grid.cellSize / 2
  // Square cells are centred on origin + k * cellSize, so their corners sit on the same half-cell lattice.
  const snap1 = (v: number, o: number) => clean(Math.round((v - o) / step) * step + o)
  return { x: snap1(p.x, grid.origin.x), z: snap1(p.z, grid.origin.z) }
}

/** Ends of every segment, for endpoint snapping. */
export function endpointsOf(segments: readonly WallSegment[]): Pt2[] {
  const out: Pt2[] = []
  for (const s of segments) out.push(s.a, s.b)
  return out
}

/** A pen stroke long enough to be a wall (a tap does not draw a zero-length one). */
export function isDrawable(a: Pt2, b: Pt2, grid: GridSpec): boolean {
  return Math.hypot(b.x - a.x, b.z - a.z) >= grid.cellSize * 0.2
}

/** Trim float noise so the document stays small and deep-equal across clients. */
export function clean(v: number): number {
  const r = Math.round(v * 1e4) / 1e4
  return r === 0 ? 0 : r
}

export function cleanPoint(p: Pt2): Pt2 {
  return { x: clean(p.x), z: clean(p.z) }
}

/** Counts for the panel: "12 walls · 3 doors (1 open)". */
export function wallSummary(walls: readonly Wall[]): string {
  const doors = walls.filter((w) => w.door)
  const open = doors.filter((w) => w.door!.open).length
  const plain = walls.length - doors.length
  const parts = [`${plain} ${plain === 1 ? 'wall' : 'walls'}`, `${doors.length} ${doors.length === 1 ? 'door' : 'doors'}${open ? ` (${open} open)` : ''}`]
  return parts.join(' · ')
}
