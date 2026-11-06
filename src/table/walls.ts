/**
 * Wall extraction and line-of-sight on the XZ plane.
 *
 * `COL_*` meshes are the only source of walls (never visual geometry). Every edge of a
 * near-vertical triangle is projected onto XZ; a vertical triangle projects to a single line,
 * so its three edges collapse onto collinear segments that are then merged into one.
 */
import { Matrix4, Vector3, type BufferGeometry } from 'three'

export interface Pt2 { x: number; z: number }
export interface WallSegment { a: Pt2; b: Pt2 }

export interface ExtractOptions {
  /** |normal.y| below this counts as vertical. Default 0.5 (steeper than 60°). */
  verticalThreshold?: number
  /** Projected edges shorter than this are dropped (vertical edges). Default 1e-3. */
  minLength?: number
  /** Positional tolerance for merging. Default 1e-3. */
  epsilon?: number
}

/** Collect XZ wall segments from one mesh geometry in world space. */
export function extractWallSegments(
  geometry: BufferGeometry,
  matrixWorld: Matrix4 = new Matrix4(),
  opts: ExtractOptions = {},
): WallSegment[] {
  const vertical = opts.verticalThreshold ?? 0.5
  const minLen = opts.minLength ?? 1e-3
  const pos = geometry.getAttribute('position')
  if (!pos) return []
  const index = geometry.getIndex()
  const triCount = index ? index.count / 3 : pos.count / 3
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const ab = new Vector3(), ac = new Vector3(), n = new Vector3()
  const raw: WallSegment[] = []
  const read = (i: number, out: Vector3) => out.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld)
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    read(i0, a); read(i1, b); read(i2, c)
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac)
    const len = n.length()
    if (len < 1e-12) continue // degenerate
    if (Math.abs(n.y / len) > vertical) continue // floor / ceiling / ramp
    pushEdge(raw, a, b, minLen); pushEdge(raw, b, c, minLen); pushEdge(raw, c, a, minLen)
  }
  return mergeSegments(raw, opts.epsilon ?? 1e-3)
}

function pushEdge(out: WallSegment[], p: Vector3, q: Vector3, minLen: number) {
  const dx = q.x - p.x, dz = q.z - p.z
  if (dx * dx + dz * dz < minLen * minLen) return
  out.push({ a: { x: p.x, z: p.z }, b: { x: q.x, z: q.z } })
}

/**
 * Merge collinear, overlapping or touching segments. Segments are bucketed by their supporting
 * line (direction angle in [0, π) and signed distance from the origin), then unioned as 1D
 * intervals along that line.
 */
export function mergeSegments(segments: WallSegment[], epsilon = 1e-3): WallSegment[] {
  type Line = { ux: number; uz: number; nx: number; nz: number; offset: number; intervals: [number, number][] }
  const lines: Line[] = []
  const angleEps = 1e-3
  for (const s of segments) {
    let ux = s.b.x - s.a.x, uz = s.b.z - s.a.z
    const len = Math.hypot(ux, uz)
    if (len < epsilon) continue
    ux /= len; uz /= len
    // canonical direction: angle in [0, π)
    if (uz < -1e-9 || (Math.abs(uz) <= 1e-9 && ux < 0)) { ux = -ux; uz = -uz }
    const nx = -uz, nz = ux
    const offset = s.a.x * nx + s.a.z * nz
    let line = lines.find((l) => Math.abs(l.ux - ux) < angleEps && Math.abs(l.uz - uz) < angleEps && Math.abs(l.offset - offset) < epsilon)
    if (!line) { line = { ux, uz, nx, nz, offset, intervals: [] }; lines.push(line) }
    const t0 = s.a.x * line.ux + s.a.z * line.uz
    const t1 = s.b.x * line.ux + s.b.z * line.uz
    line.intervals.push(t0 < t1 ? [t0, t1] : [t1, t0])
  }
  const out: WallSegment[] = []
  for (const l of lines) {
    l.intervals.sort((p, q) => p[0] - q[0])
    let [start, end] = l.intervals[0]!
    const flush = () => {
      const ox = l.nx * l.offset, oz = l.nz * l.offset
      out.push({ a: { x: ox + l.ux * start, z: oz + l.uz * start }, b: { x: ox + l.ux * end, z: oz + l.uz * end } })
    }
    for (let i = 1; i < l.intervals.length; i++) {
      const [s0, s1] = l.intervals[i]!
      if (s0 <= end + epsilon) end = Math.max(end, s1)
      else { flush(); start = s0; end = s1 }
    }
    flush()
  }
  return out
}

/** True when segments p1-p2 and p3-p4 intersect (touching counts). */
export function segmentsIntersect(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): boolean {
  const d1x = p2.x - p1.x, d1z = p2.z - p1.z
  const d2x = p4.x - p3.x, d2z = p4.z - p3.z
  const denom = d1x * d2z - d1z * d2x
  const ex = p3.x - p1.x, ez = p3.z - p1.z
  if (Math.abs(denom) < 1e-12) {
    // parallel: overlap only if collinear
    if (Math.abs(ex * d1z - ez * d1x) > 1e-9) return false
    const len2 = d1x * d1x + d1z * d1z
    if (len2 < 1e-18) return false
    const t0 = (ex * d1x + ez * d1z) / len2
    const t1 = ((p4.x - p1.x) * d1x + (p4.z - p1.z) * d1z) / len2
    return Math.max(Math.min(t0, t1), 0) <= Math.min(Math.max(t0, t1), 1)
  }
  const t = (ex * d2z - ez * d2x) / denom
  const u = (ex * d1z - ez * d1x) / denom
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

/** True when no wall blocks the straight line from `from` to `to`. */
export function hasLineOfSight(from: Pt2, to: Pt2, walls: readonly WallSegment[]): boolean {
  for (const w of walls) if (segmentsIntersect(from, to, w.a, w.b)) return false
  return true
}

/**
 * Nearest intersection of the ray from `from` towards `to` with any wall, as a fraction of the
 * `from`-`to` distance (1 = unobstructed). Useful for debug drawing.
 */
export function castRay(from: Pt2, to: Pt2, walls: readonly WallSegment[]): number {
  let best = 1
  const d1x = to.x - from.x, d1z = to.z - from.z
  for (const w of walls) {
    const d2x = w.b.x - w.a.x, d2z = w.b.z - w.a.z
    const denom = d1x * d2z - d1z * d2x
    if (Math.abs(denom) < 1e-12) continue
    const ex = w.a.x - from.x, ez = w.a.z - from.z
    const t = (ex * d2z - ez * d2x) / denom
    const u = (ex * d1z - ez * d1x) / denom
    if (t >= 0 && t < best && u >= 0 && u <= 1) best = t
  }
  return best
}
