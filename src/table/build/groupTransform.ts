/**
 * Transforms of a prop selection as a group: move, turn around an axis and scale, all about the
 * selection's centre, and the one batched `props.update` that commits the result. Pure (three.js
 * maths only), so the gizmo, the power keys, the touch gestures and the inspector share it.
 */
import { Euler, Quaternion, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { PropId } from '@/core/ids'
import type { PropUpdate } from '@/core/intents'
import { PROP_SCALE_LIMITS, propScale } from '@/core/props'

/** What a transform changes on a prop. `rotation` is Euler radians, order 'XYZ' like `Prop.rotation`. */
export interface PropPose {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export type Poses = Record<PropId, PropPose>

export type Axis = 'x' | 'y' | 'z'

export const AXES: Record<Axis, Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
}

export type GroupOp =
  | { kind: 'move'; delta: Vec3 }
  /** Turn by `angle` radians around the world-space unit `axis` through `centre`. */
  | { kind: 'rotate'; axis: Vec3; angle: number; centre: Vec3 }
  /** Uniform scale by `factor` about `centre`. */
  | { kind: 'scale'; factor: number; centre: Vec3 }
  /**
   * Scale by `factor` along one axis of a frame (`frame` turns frame axes into world axes;
   * identity is world space) about `centre`. Each prop stretches along its own local axis that
   * lines up best with that direction, since a prop's scale is per local axis.
   */
  | { kind: 'scale-axis'; axis: Axis; factor: number; centre: Vec3; frame?: { x: number; y: number; z: number; w: number } }

/** The pose of `prop`; a version 1 number scale is read with its legacy fit (1 when unknown). */
export function poseOf(prop: Pick<Prop, 'position' | 'rotation' | 'scale'>, legacyFit = 1): PropPose {
  return { position: { ...prop.position }, rotation: { ...prop.rotation }, scale: { ...propScale(prop, legacyFit) } }
}

/**
 * Centre of a selection: the middle of the positions' bounding box on the floor plane, at the
 * lowest position's height (the pivot sits on the ground under the group).
 */
export function selectionCentre(poses: readonly PropPose[]): Vec3 {
  if (poses.length === 0) return { x: 0, y: 0, z: 0 }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity
  for (const p of poses) {
    minX = Math.min(minX, p.position.x); maxX = Math.max(maxX, p.position.x)
    minZ = Math.min(minZ, p.position.z); maxZ = Math.max(maxZ, p.position.z)
    minY = Math.min(minY, p.position.y)
  }
  return { x: (minX + maxX) / 2, y: minY, z: (minZ + maxZ) / 2 }
}

const clean = (v: number) => {
  const r = Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(9))
  return r === 0 ? 0 : r
}
const cleanVec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: clean(v.x), y: clean(v.y), z: clean(v.z) })
const clampScale = (v: number) => Math.min(PROP_SCALE_LIMITS.max, Math.max(PROP_SCALE_LIMITS.min, v))

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Euler 'XYZ' angles of a quaternion. Every orientation has two such triples, (x, y, z) and
 * (x + π, π − y, z + π); this picks the one with the smaller tilts, so a prop only ever turned
 * about Y keeps x = z = 0 (three.js would give 165° of yaw as x = 180°, y = 15°, z = 180°).
 */
export function eulerOf(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  let { x, y, z } = e
  if (Math.abs(x) > Math.PI / 2 && Math.abs(z) > Math.PI / 2) {
    x = wrap(x + Math.PI)
    y = wrap(Math.PI - y)
    z = wrap(z + Math.PI)
  }
  return cleanVec({ x, y, z })
}

/** Apply `op` to one pose. */
export function applyOp(pose: PropPose, op: GroupOp): PropPose {
  switch (op.kind) {
    case 'move':
      return { ...pose, position: cleanVec({ x: pose.position.x + op.delta.x, y: pose.position.y + op.delta.y, z: pose.position.z + op.delta.z }) }
    case 'rotate': {
      const axis = new Vector3(op.axis.x, op.axis.y, op.axis.z).normalize()
      const q = new Quaternion().setFromAxisAngle(axis, op.angle)
      const c = new Vector3(op.centre.x, op.centre.y, op.centre.z)
      const p = new Vector3(pose.position.x, pose.position.y, pose.position.z).sub(c).applyQuaternion(q).add(c)
      const r = new Quaternion().setFromEuler(new Euler(pose.rotation.x, pose.rotation.y, pose.rotation.z, 'XYZ')).premultiply(q)
      return { ...pose, position: cleanVec(p), rotation: eulerOf(r) }
    }
    case 'scale': {
      const f = op.factor
      const c = op.centre
      return {
        ...pose,
        position: cleanVec({ x: c.x + (pose.position.x - c.x) * f, y: c.y + (pose.position.y - c.y) * f, z: c.z + (pose.position.z - c.z) * f }),
        scale: cleanVec({ x: clampScale(pose.scale.x * f), y: clampScale(pose.scale.y * f), z: clampScale(pose.scale.z * f) }),
      }
    }
    case 'scale-axis': {
      const frame = op.frame ? new Quaternion(op.frame.x, op.frame.y, op.frame.z, op.frame.w) : new Quaternion()
      const dir = new Vector3(AXES[op.axis].x, AXES[op.axis].y, AXES[op.axis].z).applyQuaternion(frame)
      const c = new Vector3(op.centre.x, op.centre.y, op.centre.z)
      // Offset from the centre: stretch its component along `dir`.
      const d = new Vector3(pose.position.x, pose.position.y, pose.position.z).sub(c)
      const along = d.dot(dir)
      d.addScaledVector(dir, along * (op.factor - 1)).add(c)
      // The prop's local axis closest to `dir`.
      const rq = new Quaternion().setFromEuler(new Euler(pose.rotation.x, pose.rotation.y, pose.rotation.z, 'XYZ'))
      const local = (['x', 'y', 'z'] as const).map((k) => {
        const a = new Vector3(AXES[k].x, AXES[k].y, AXES[k].z).applyQuaternion(rq)
        return { k, dot: Math.abs(a.dot(dir)) }
      }).sort((a, b) => b.dot - a.dot)[0]!.k
      const scale = { ...pose.scale, [local]: clampScale(pose.scale[local] * op.factor) }
      return { ...pose, position: cleanVec(d), scale: cleanVec(scale) }
    }
  }
}

/** Apply `op` to every pose. */
export function applyGroupOp(poses: Poses, op: GroupOp): Poses {
  const out: Poses = {}
  for (const id of Object.keys(poses) as PropId[]) out[id] = applyOp(poses[id]!, op)
  return out
}

const near = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7 && Math.abs(a.z - b.z) < 1e-7

/**
 * The `props.update` entries that turn `before` into `after`: only changed fields, only changed
 * props. Commit them as one intent so the whole group edit is one undo step.
 */
export function updatesFrom(before: Poses, after: Poses): PropUpdate[] {
  const out: PropUpdate[] = []
  for (const id of Object.keys(after) as PropId[]) {
    const a = after[id]!
    const b = before[id]
    if (!b) continue
    const patch: PropUpdate['patch'] = {}
    if (!near(a.position, b.position)) patch.position = a.position
    if (!near(a.rotation, b.rotation)) patch.rotation = a.rotation
    if (!near(a.scale, b.scale)) patch.scale = a.scale
    if (Object.keys(patch).length) out.push({ id, patch })
  }
  return out
}

/** The yaw delta that leaves `startYaw + raw` on a multiple of `step` (radians); `step` 0 keeps `raw`. */
export function snappedYawDelta(startYaw: number, raw: number, step: number): number {
  if (step <= 0) return raw
  const target = Math.round((startYaw + raw) / step) * step
  return target - startYaw
}

/** A factor snapped to `step` (0.05 → ×1.05, ×1.10…), never below `step`. */
export function snapFactor(f: number, step: number): number {
  if (step <= 0) return f
  return Math.max(step, Math.round(f / step) * step)
}
