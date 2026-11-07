/**
 * Wall extraction and line-of-sight on the XZ plane.
 *
 * `COL_*` meshes are the only source of walls (never visual geometry). Every edge of a
 * near-vertical triangle is projected onto XZ; a vertical triangle projects to a single line,
 * so its three edges collapse onto collinear segments that are then merged into one.
 */
import { Matrix4, Vector3, type BufferGeometry } from 'three'
import { mergeSegments, type WallSegment } from './segments'

export { mergeSegments, segmentsIntersect, hasLineOfSight, castRay } from './segments'
export type { Pt2, WallSegment } from './segments'

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
