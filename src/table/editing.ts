/**
 * Pure helpers for in-game object editing: snapping, angle conversions, scene override
 * merging, prop footprints for line-of-sight and scene-node picking rules.
 */
import { Box3, Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type { NodeOverride, SceneTransform } from '@/core/doc'
import type { GridSpec, Vec3 } from '@/core/geometry'
import type { WallSegment } from './walls'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

/** Snap steps shared by the gizmo and the panel. */
export const SNAP = {
  /** Fraction of a cell for floor translation. */
  cellFraction: 0.5,
  /** Vertical translation step in meters. */
  height: 0.1,
  /** Rotation step in degrees. */
  degrees: 15,
  scale: 0.05,
} as const

export const SCALE_LIMITS = { min: 0.05, max: 50 } as const
export const TOKEN_SIZE_LIMITS = { min: 0.25, max: 4 } as const

export const IDENTITY_TRANSFORM: SceneTransform = { scale: 1, rotationY: 0, offset: { x: 0, y: 0, z: 0 } }

export const radToDeg = (r: number): number => (r * 180) / Math.PI
export const degToRad = (d: number): number => (d * Math.PI) / 180

/** Wrap degrees into (-180, 180]. */
export function normalizeDeg(d: number): number {
  let v = ((d + 180) % 360 + 360) % 360 - 180
  if (v === -180) v = 180
  return v === 0 ? 0 : v
}

/** Degrees shown in the panel: rounded to a tenth, -0 removed. */
export function displayDeg(rad: number): number {
  const v = Math.round(normalizeDeg(radToDeg(rad)) * 10) / 10
  return v === 0 ? 0 : v
}

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value
  const v = Math.round(value / step) * step
  // kill float noise like 1.2000000000000002 and -0
  const r = Number(v.toFixed(6))
  return r === 0 ? 0 : r
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Snap an angle (radians) to the configured degree step. */
export function snapAngle(rad: number, stepDeg: number = SNAP.degrees): number {
  const step = degToRad(stepDeg)
  const v = Math.round(rad / step) * step
  return Math.abs(v) < 1e-9 ? 0 : v
}

export function snapScale(scale: number, step: number = SNAP.scale): number {
  return clamp(roundTo(scale, step), SCALE_LIMITS.min, SCALE_LIMITS.max)
}

/**
 * Snap a world position: x/z to a fraction of a cell measured from the grid origin, y to a
 * height step. Grids of type 'none' still snap on their nominal cell size.
 */
export function snapTranslation(p: Vec3, grid: GridSpec, fraction: number = SNAP.cellFraction, heightStep: number = SNAP.height): Vec3 {
  const step = grid.cellSize * fraction
  return {
    x: roundTo(p.x - grid.origin.x, step) + grid.origin.x,
    y: roundTo(p.y, heightStep),
    z: roundTo(p.z - grid.origin.z, step) + grid.origin.z,
  }
}

// ------------------------------------------------------------------ overrides

export type Overrides = Record<string, NodeOverride>

/** Merge a partial override into the map; empty results drop the key so "reset" is just absence. */
export function mergeOverride(overrides: Overrides | undefined, node: string, patch: Partial<NodeOverride>): Overrides {
  const out: Overrides = { ...(overrides ?? {}) }
  const next: NodeOverride = { ...(out[node] ?? {}) }
  for (const [k, v] of Object.entries(patch) as [keyof NodeOverride, NodeOverride[keyof NodeOverride]][]) {
    if (v === undefined) delete next[k]
    else (next as Record<string, unknown>)[k] = v
  }
  if (Object.keys(next).length === 0) delete out[node]
  else out[node] = next
  return out
}

export function resetOverride(overrides: Overrides | undefined, node: string): Overrides {
  const out: Overrides = { ...(overrides ?? {}) }
  delete out[node]
  return out
}

export function isIdentityTransform(t: SceneTransform | undefined): boolean {
  if (!t) return true
  return t.scale === 1 && t.rotationY === 0 && t.offset.x === 0 && t.offset.y === 0 && t.offset.z === 0
}

/** Matrix of a scene transform: scale about the origin, turn around Y, then move by offset. */
export function sceneTransformMatrix(t: SceneTransform | undefined, out: Matrix4 = new Matrix4()): Matrix4 {
  const tr = t ?? IDENTITY_TRANSFORM
  return out.compose(
    new Vector3(tr.offset.x, tr.offset.y, tr.offset.z),
    new Quaternion().setFromEuler(new Euler(0, tr.rotationY, 0)),
    new Vector3(tr.scale, tr.scale, tr.scale),
  )
}

/** Apply a scene transform to wall segments on the XZ plane. */
export function transformWalls(walls: readonly WallSegment[], t: SceneTransform | undefined): WallSegment[] {
  if (isIdentityTransform(t)) return walls as WallSegment[]
  const m = sceneTransformMatrix(t)
  const v = new Vector3()
  const map = (p: { x: number; z: number }) => {
    v.set(p.x, 0, p.z).applyMatrix4(m)
    return { x: v.x, z: v.z }
  }
  return walls.map((w) => ({ a: map(w.a), b: map(w.b) }))
}

// ------------------------------------------------------------------ footprints

/** The four XZ edges of a world-space bounding box, as wall segments. Empty boxes give none. */
export function footprintWalls(box: { min: Vec3; max: Vec3 }): WallSegment[] {
  const { min, max } = box
  if (!(max.x > min.x) || !(max.z > min.z)) return []
  const c = [
    { x: min.x, z: min.z }, { x: max.x, z: min.z }, { x: max.x, z: max.z }, { x: min.x, z: max.z },
  ]
  return [
    { a: c[0]!, b: c[1]! }, { a: c[1]!, b: c[2]! }, { a: c[2]!, b: c[3]! }, { a: c[3]!, b: c[0]! },
  ]
}

export function footprintOfObject(object: Object3D, box: Box3 = new Box3()): WallSegment[] {
  object.updateWorldMatrix(true, true)
  box.setFromObject(object, true)
  if (box.isEmpty()) return []
  return footprintWalls(box)
}

// ------------------------------------------------------------------ node picking

/** Name prefixes of helper nodes that are never selectable. */
export const HELPER_PREFIXES = ['COL_', 'FOG_', 'GRID', 'SPAWN_', 'LIGHT_'] as const

export function isHelperName(name: string): boolean {
  return HELPER_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * The node a tap on `hit` selects: the nearest ancestor (the hit itself first) below `root` with a
 * non-helper name. A multi-primitive glTF mesh becomes a group named `pillar` with children
 * `pillar_0`, `pillar_1`; those resolve to the group.
 */
export function nearestNamedNode(hit: Object3D, root: Object3D): Object3D | null {
  let o: Object3D | null = hit
  while (o && o !== root) {
    const name = o.name ?? ''
    if (name && !isHelperName(name)) {
      const parent = o.parent
      if (parent && parent !== root && parent.name && new RegExp(`^${escapeRe(parent.name)}_\\d+$`).test(name)) return parent
      return o
    }
    o = o.parent
  }
  return null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when the object and all its ancestors are visible. */
export function isVisibleInTree(o: Object3D | null): boolean {
  while (o) {
    if (!o.visible) return false
    o = o.parent
  }
  return true
}

// ------------------------------------------------------------------ base transforms

/** Transform a scene node had when the GLB was loaded; overrides are applied relative to it. */
export interface NodeBase {
  position: Vec3
  /** Euler angles in YXZ order (radians). */
  rotation: Vec3
  /** Authored scale; an override's `scale` multiplies it. */
  scale: Vec3
  visible: boolean
}

export function readBase(o: Object3D): NodeBase {
  const e = new Euler().setFromQuaternion(o.quaternion, 'YXZ')
  return {
    position: { x: o.position.x, y: o.position.y, z: o.position.z },
    rotation: { x: e.x, y: e.y, z: e.z },
    scale: { x: o.scale.x, y: o.scale.y, z: o.scale.z },
    visible: o.visible,
  }
}

export interface NodeTransform {
  position: Vec3
  rotationY: number
  /** Multiplier on the authored scale; 1 = as authored. */
  scale: number
  hidden: boolean
}

/** Local transform the node shows with an override applied on top of its base. */
export function effectiveNodeTransform(base: NodeBase, override: NodeOverride | undefined): NodeTransform {
  return {
    position: override?.position ?? base.position,
    rotationY: override?.rotationY ?? base.rotation.y,
    scale: override?.scale ?? 1,
    hidden: override?.hidden ?? false,
  }
}

/** Write a node transform onto the object (rotation x/z and scale proportions stay as authored). */
export function applyNodeTransform(o: Object3D, base: NodeBase, t: NodeTransform): void {
  o.position.set(t.position.x, t.position.y, t.position.z)
  o.rotation.set(base.rotation.x, t.rotationY, base.rotation.z, 'YXZ')
  o.scale.set(base.scale.x * t.scale, base.scale.y * t.scale, base.scale.z * t.scale)
  o.visible = base.visible && !t.hidden
}
