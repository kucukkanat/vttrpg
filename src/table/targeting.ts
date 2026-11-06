/**
 * Targeting geometry on the XZ plane. Pure; no three.js.
 *
 * A `TargetShape` from a skill plus the source position and the pointer position resolve into a
 * `ResolvedShape` with world-space geometry. Membership tests (`pointInShape`, `tokensInShape`,
 * `cellsInShape`) share one predicate so the preview, the highlights and the pick agree.
 * Distances are Euclidean in world units; `range` / `radius` / `width` are in cells.
 * Cone `angle` is the full opening angle in degrees.
 */
import type { Cell, GridSpec, TargetShape, Vec2 } from '@/core/geometry'
import { cellsWithinRadius, cellToWorld } from './grid'

/** Tolerance so a token standing exactly on the boundary counts as inside. */
const EPS = 1e-6

export type ResolvedShape =
  | { kind: 'self'; center: Vec2 }
  /** Range disc around the source; the pick is one token inside it. */
  | { kind: 'single'; center: Vec2; range: number }
  | { kind: 'radius'; center: Vec2; radius: number; source: Vec2; range: number }
  /** Wedge from `apex` toward `direction` (radians, atan2(z, x)). */
  | { kind: 'cone'; apex: Vec2; direction: number; length: number; halfAngle: number }
  /** Strip of `width` centred on the segment `from` -> `to`. */
  | { kind: 'line'; from: Vec2; to: Vec2; width: number }

export interface Positioned { id: string; x: number; z: number }

/** Clamp `p` so it lies within `maxDist` of `origin`. */
export function clampToRange(origin: Vec2, p: Vec2, maxDist: number): Vec2 {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  const d = Math.hypot(dx, dy)
  if (d <= maxDist || d === 0) return { x: p.x, y: p.y }
  const k = maxDist / d
  return { x: origin.x + dx * k, y: origin.y + dy * k }
}

/**
 * Direction from source toward the pointer in radians. When the pointer sits on the source the
 * direction is undefined; `fallback` (e.g. the token's facing) is used instead.
 */
export function directionTo(source: Vec2, pointer: Vec2, fallback = 0): number {
  const dx = pointer.x - source.x
  const dy = pointer.y - source.y
  if (Math.hypot(dx, dy) < 1e-4) return fallback
  return Math.atan2(dy, dx)
}

/**
 * Turn a skill's target shape into world geometry. `source` and `pointer` are world (x, z);
 * `Vec2.y` is the world z. `facing` is the fallback direction for cones and lines (radians).
 */
export function resolveShape(grid: GridSpec, shape: TargetShape, source: Vec2, pointer: Vec2, facing = 0): ResolvedShape {
  const s = grid.cellSize
  switch (shape.kind) {
    case 'self':
      return { kind: 'self', center: { x: source.x, y: source.y } }
    case 'single':
      return { kind: 'single', center: { x: source.x, y: source.y }, range: shape.range * s }
    case 'radius': {
      const center = clampToRange(source, pointer, shape.range * s)
      return { kind: 'radius', center, radius: shape.radius * s, source: { x: source.x, y: source.y }, range: shape.range * s }
    }
    case 'cone':
      return {
        kind: 'cone',
        apex: { x: source.x, y: source.y },
        direction: directionTo(source, pointer, facing),
        length: shape.range * s,
        halfAngle: (shape.angle * Math.PI) / 360,
      }
    case 'line': {
      const dir = directionTo(source, pointer, facing)
      const len = shape.range * s
      return {
        kind: 'line',
        from: { x: source.x, y: source.y },
        to: { x: source.x + Math.cos(dir) * len, y: source.y + Math.sin(dir) * len },
        width: shape.width * s,
      }
    }
  }
}

/** Smallest signed difference between two angles, in (-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d <= -Math.PI) d += 2 * Math.PI
  return d
}

/** Is the world point inside the shape's area? For 'self' only the exact centre; for 'single' the range disc. */
export function pointInShape(shape: ResolvedShape, p: Vec2): boolean {
  switch (shape.kind) {
    case 'self':
      return Math.hypot(p.x - shape.center.x, p.y - shape.center.y) <= EPS
    case 'single':
      return Math.hypot(p.x - shape.center.x, p.y - shape.center.y) <= shape.range + EPS
    case 'radius':
      return Math.hypot(p.x - shape.center.x, p.y - shape.center.y) <= shape.radius + EPS
    case 'cone': {
      const dx = p.x - shape.apex.x
      const dy = p.y - shape.apex.y
      const d = Math.hypot(dx, dy)
      if (d <= EPS) return false // the apex itself is not in the cone
      if (d > shape.length + EPS) return false
      return Math.abs(angleDiff(Math.atan2(dy, dx), shape.direction)) <= shape.halfAngle + EPS
    }
    case 'line': {
      const ax = shape.to.x - shape.from.x
      const ay = shape.to.y - shape.from.y
      const len2 = ax * ax + ay * ay
      if (len2 <= EPS) return false
      const px = p.x - shape.from.x
      const py = p.y - shape.from.y
      const t = (px * ax + py * ay) / len2
      if (t < -EPS || t > 1 + EPS) return false
      const perp = Math.abs(px * ay - py * ax) / Math.sqrt(len2)
      return perp <= shape.width / 2 + EPS
    }
  }
}

/**
 * Tokens whose centre is inside the shape. The source is never hit by its own cone or line and
 * is the only target of 'self'; for 'single' the result is every token in range (the pick
 * narrows it to one).
 */
export function tokensInShape(shape: ResolvedShape, tokens: readonly Positioned[], sourceId?: string): string[] {
  if (shape.kind === 'self') return sourceId ? [sourceId] : []
  const out: string[] = []
  for (const t of tokens) {
    if ((shape.kind === 'cone' || shape.kind === 'line') && t.id === sourceId) continue
    if (pointInShape(shape, { x: t.x, y: t.z })) out.push(t.id)
  }
  return out
}

/** Tokens the shape could reach from the source at all; others are dimmed in the preview. */
export function tokensInRange(grid: GridSpec, shape: TargetShape, source: Vec2, tokens: readonly Positioned[], sourceId?: string): string[] {
  const s = grid.cellSize
  let reach: number
  switch (shape.kind) {
    case 'self': return sourceId ? [sourceId] : []
    case 'single': reach = shape.range * s; break
    case 'radius': reach = (shape.range + shape.radius) * s; break
    case 'cone': case 'line': reach = shape.range * s; break
  }
  return tokens
    .filter((t) => !((shape.kind === 'cone' || shape.kind === 'line') && t.id === sourceId))
    .filter((t) => Math.hypot(t.x - source.x, t.z - source.y) <= reach + EPS)
    .map((t) => t.id)
}

/** Centre and reach of a disc that fully contains the shape (for iterating candidate cells). */
export function shapeExtent(shape: ResolvedShape): { center: Vec2; radius: number } {
  switch (shape.kind) {
    case 'self': return { center: shape.center, radius: 0 }
    case 'single': return { center: shape.center, radius: shape.range }
    case 'radius': return { center: shape.center, radius: shape.radius }
    case 'cone': return { center: shape.apex, radius: shape.length }
    case 'line': {
      const center = { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 }
      return { center, radius: Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) / 2 + shape.width / 2 }
    }
  }
}

/** Grid cells whose centres lie inside the shape (for 'single' the cells in range). */
export function cellsInShape(grid: GridSpec, shape: ResolvedShape): Cell[] {
  const { center, radius } = shapeExtent(shape)
  const candidates = cellsWithinRadius(grid, center.x, center.y, radius / grid.cellSize + 1)
  return candidates.filter((c) => {
    const w = cellToWorld(grid, c)
    return pointInShape(shape, w)
  })
}

/** The token whose footprint (half a cell, scaled) contains the point, nearest first. */
export function tokenAt(point: Vec2, tokens: readonly (Positioned & { scale?: number })[], cellSize: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const t of tokens) {
    const d = Math.hypot(t.x - point.x, t.z - point.y)
    if (d <= 0.5 * cellSize * (t.scale ?? 1) + EPS && d < bestD) { best = t.id; bestD = d }
  }
  return best
}

/** Outline of the shape as a closed polygon (x, z), for drawing. 'self' and 'single' are circles. */
export function shapeOutline(shape: ResolvedShape, segments = 48): Vec2[] {
  const circle = (c: Vec2, r: number): Vec2[] => {
    const pts: Vec2[] = []
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r })
    }
    return pts
  }
  switch (shape.kind) {
    case 'self': return circle(shape.center, 0)
    case 'single': return circle(shape.center, shape.range)
    case 'radius': return circle(shape.center, shape.radius)
    case 'cone': {
      const pts: Vec2[] = [{ x: shape.apex.x, y: shape.apex.y }]
      const n = Math.max(8, Math.round((segments * shape.halfAngle) / Math.PI))
      for (let i = 0; i <= n; i++) {
        const a = shape.direction - shape.halfAngle + (2 * shape.halfAngle * i) / n
        pts.push({ x: shape.apex.x + Math.cos(a) * shape.length, y: shape.apex.y + Math.sin(a) * shape.length })
      }
      return pts
    }
    case 'line': {
      const ax = shape.to.x - shape.from.x
      const ay = shape.to.y - shape.from.y
      const len = Math.hypot(ax, ay) || 1
      const nx = (-ay / len) * (shape.width / 2)
      const ny = (ax / len) * (shape.width / 2)
      return [
        { x: shape.from.x + nx, y: shape.from.y + ny },
        { x: shape.to.x + nx, y: shape.to.y + ny },
        { x: shape.to.x - nx, y: shape.to.y - ny },
        { x: shape.from.x - nx, y: shape.from.y - ny },
      ]
    }
  }
}
