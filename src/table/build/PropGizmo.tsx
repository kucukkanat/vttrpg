/**
 * The prop gizmo, on the prop selection (GM, Build or edit mode). Everything acts on the whole
 * selection about its centre (floor centre of the positions, lowest height) and commits one
 * `props.update` on release, so one drag is one undo step.
 *
 * Simple (default), for what tabletop props need:
 *   - move: drag the props themselves (usePropPointer), snapped to half cells, Alt free
 *   - a turn ring on the floor around the selection: 15° steps, 90° with Shift, Alt free
 *   - a height arrow above it: 0.1 m steps, Alt free
 *   - a scale cube on the ring: uniform, 0.05 steps, Alt free
 * Advanced (A, or the edit bar): adds X / Y / Z rings and a scale cube per axis, in world axes or
 * the primary prop's own (`gizmoSpace`).
 *
 * Handles are drawn a few pixels thick at a constant screen size and hit-tested on invisible
 * shapes at least 44 px wide on coarse pointers (20 px with a mouse). The handles hide while
 * anything is being dragged. Tab's mode (`gizmoMode`) highlights the matching handle.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Box3, Euler, PerspectiveCamera, Plane, Quaternion, Vector3, type Camera, type Ray } from 'three'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import { useGame } from '@/state/store'
import { SELECT } from '@/ui/theme/palette'
import { useTable } from '../context'
import { roundTo, SNAP } from '../editing'
import { useTableUi } from '../tableState'
import { capture } from '../TokenMesh'
import { isCoarsePointer, propObjects } from './editRuntime'
import { applyGroupOp, AXES, selectionCentre, snapFactor, snappedYawDelta, type Axis, type GroupOp, type Poses } from './groupTransform'
import { commitGroupOp, posesOf } from './propActions'
import { TURN_STEP, TURN_STEP_COARSE } from './transformKeys'

const AXIS_COLOR: Record<Axis, string> = { x: '#ff5a7a', y: '#8fd18f', z: '#5aa9ff' }
/** Ring radius at least this many pixels. */
const RING_PX = 70
const LINE_PX = 3
const ARROW_PX = 46
const CUBE_PX = 14
const noRaycast = () => undefined

export function PropGizmo() {
  const { sceneId, viewer } = useTable()
  const ids = useGame((s) => s.propSelection)
  const props = useGame((s) => s.props)
  const editMode = useTableUi((s) => s.editMode)
  const buildMode = useTableUi((s) => s.buildMode)
  const targeting = useTableUi((s) => s.targeting !== null)
  const gm = !viewer || viewer.isGm
  const list = useMemo(() => ids.map((id) => props[id]).filter((p): p is Prop => !!p && p.scene === sceneId), [ids, props, sceneId])
  if (!gm || targeting || !(editMode || buildMode) || list.length === 0) return null
  return <GizmoBody props={list} />
}

interface Metrics {
  /** World units per screen pixel at the centre. */
  wpp: number
  /** Ring radius (world). */
  ring: number
  /** Azimuth of the scale cube on the ring, facing the camera. */
  az: number
}

/** World size of one pixel at `p` for the current camera. */
function worldPerPixel(camera: Camera, p: Vector3, heightPx: number): number {
  if (camera instanceof PerspectiveCamera) {
    const d = camera.position.distanceTo(p)
    return (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, heightPx)
  }
  const o = camera as Camera & { top?: number; bottom?: number; zoom?: number }
  return ((o.top ?? 1) - (o.bottom ?? -1)) / (o.zoom ?? 1) / Math.max(1, heightPx)
}

type DragKind =
  | { kind: 'yaw' }
  | { kind: 'ring'; axis: Axis }
  | { kind: 'height' }
  | { kind: 'scale' }
  | { kind: 'scale-axis'; axis: Axis }

interface Drag {
  pointerId: number
  what: DragKind
  poses: Poses
  centre: Vector3
  /** Rotation axis or scale direction in world space. */
  dir: Vector3
  plane: Plane
  start: Vector3
  /** Scale along an axis: the starting parameter along `dir`. */
  t0: number
  op: GroupOp | null
}

function GizmoBody({ props }: { props: Prop[] }) {
  const { onIntent } = useTable()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const dragging = useTableUi((s) => s.editDrag)
  const advanced = useTableUi((s) => s.advanced)
  const space = useTableUi((s) => s.gizmoSpace)
  const mode = useTableUi((s) => s.gizmoMode)
  const poses = useMemo(() => posesOf(props), [props])
  const centre = useMemo(() => selectionCentre(Object.values(poses)), [poses])
  const c = useMemo(() => new Vector3(centre.x, centre.y, centre.z), [centre])
  const primary = props[props.length - 1]!
  const frame = useMemo(() => {
    if (space !== 'local' || !advanced) return new Quaternion()
    return new Quaternion().setFromEuler(new Euler(primary.rotation.x, primary.rotation.y, primary.rotation.z, 'XYZ'))
  }, [space, advanced, primary.rotation.x, primary.rotation.y, primary.rotation.z])

  // Footprint radius and top of the selection, from the drawn meshes when available. Models load
  // after the selection is made, so look again a moment later.
  const [boundsTick, setBoundsTick] = useState(0)
  useEffect(() => { const t = setTimeout(() => setBoundsTick((n) => n + 1), 600); return () => clearTimeout(t) }, [props])
  const extent = useMemo(() => {
    const box = new Box3()
    for (const p of props) {
      const o = propObjects.get(p.id)
      if (o) { o.updateWorldMatrix(true, true); box.union(new Box3().setFromObject(o, true)) }
      box.expandByPoint(new Vector3(p.position.x, p.position.y, p.position.z))
    }
    let radius = 0
    if (!box.isEmpty()) {
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) radius = Math.max(radius, Math.hypot(x - c.x, z - c.z))
    }
    return { radius, top: box.isEmpty() ? c.y : box.max.y }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, c, boundsTick])

  const [m, setM] = useState<Metrics>(() => ({ wpp: 0.01, ring: 1, az: 0 }))
  useFrame(() => {
    const wpp = worldPerPixel(camera, c, size.height)
    const ring = Math.max(RING_PX * wpp, extent.radius * 1.12 + 10 * wpp)
    const step = Math.PI / 12
    const az = Math.round(Math.atan2(camera.position.x - c.x, camera.position.z - c.z) / step) * step
    // Re-render only when the size moved noticeably (zooming) or the camera swung round.
    if (Math.abs(wpp - m.wpp) / m.wpp > 0.04 || Math.abs(ring - m.ring) / m.ring > 0.04 || az !== m.az) setM({ wpp, ring, az })
  })

  const hitPx = isCoarsePointer() ? 44 : 20
  const drag = useRef<Drag | null>(null)
  const hit = useMemo(() => new Vector3(), [])

  // A drag cut short (unmount, selection change) leaves no preview behind.
  useEffect(() => () => {
    if (!drag.current) return
    drag.current = null
    useTableUi.getState().set({ propPreview: null, editDrag: false })
  }, [])

  const planeFacing = (axisDir: Vector3, through: Vector3) => {
    // A plane containing the axis line and facing the camera as much as it can.
    const toCam = new Vector3().subVectors(camera.position, through)
    const n = toCam.sub(axisDir.clone().multiplyScalar(toCam.dot(axisDir))).normalize()
    return new Plane().setFromNormalAndCoplanarPoint(n.lengthSq() > 0 ? n : new Vector3(0, 0, 1), through)
  }
  const along = (ray: Ray, d: Drag): number | null => (ray.intersectPlane(d.plane, hit) ? hit.clone().sub(d.centre).dot(d.dir) : null)

  const begin = (what: DragKind) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const dir = what.kind === 'yaw' || what.kind === 'height' || what.kind === 'scale'
      ? new Vector3(0, 1, 0)
      : new Vector3(AXES[what.axis].x, AXES[what.axis].y, AXES[what.axis].z).applyQuaternion(frame)
    let plane: Plane
    switch (what.kind) {
      case 'yaw': case 'scale': plane = new Plane(new Vector3(0, 1, 0), -c.y); break
      case 'ring': plane = new Plane().setFromNormalAndCoplanarPoint(dir, c); break
      case 'height': case 'scale-axis': plane = planeFacing(dir, c); break
    }
    if (!e.ray.intersectPlane(plane, hit)) return
    capture(e).setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const d: Drag = { pointerId: e.pointerId, what, poses, centre: c.clone(), dir, plane, start: hit.clone(), t0: 0, op: null }
    if (what.kind === 'scale-axis') d.t0 = along(e.ray, d) ?? 0
    drag.current = d
    useTableUi.getState().set({ editDrag: true })
  }

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (!e.ray.intersectPlane(d.plane, hit)) return
    const ne = e.nativeEvent
    const free = ne.altKey || !useTableUi.getState().snap
    const step = free ? 0 : ((ne.shiftKey ? TURN_STEP_COARSE : TURN_STEP) * Math.PI) / 180
    const centreVec: Vec3 = { x: d.centre.x, y: d.centre.y, z: d.centre.z }
    let op: GroupOp | null = null
    switch (d.what.kind) {
      case 'yaw': case 'ring': {
        const v0 = d.start.clone().sub(d.centre)
        const v1 = hit.clone().sub(d.centre)
        const raw = Math.atan2(d.dir.dot(new Vector3().crossVectors(v0, v1)), v0.dot(v1))
        const startYaw = d.poses[primary.id]?.rotation.y ?? 0
        const angle = d.what.kind === 'yaw' ? snappedYawDelta(startYaw, raw, step) : step ? Math.round(raw / step) * step : raw
        op = { kind: 'rotate', axis: { x: d.dir.x, y: d.dir.y, z: d.dir.z }, angle, centre: centreVec }
        break
      }
      case 'height': {
        const dy = hit.y - d.start.y
        op = { kind: 'move', delta: { x: 0, y: free ? dy : roundTo(dy, SNAP.height), z: 0 } }
        break
      }
      case 'scale': {
        const r0 = Math.hypot(d.start.x - d.centre.x, d.start.z - d.centre.z)
        const r1 = Math.hypot(hit.x - d.centre.x, hit.z - d.centre.z)
        if (r0 < 1e-6) return
        const f = Math.min(20, Math.max(0.05, r1 / r0))
        op = { kind: 'scale', factor: free ? f : snapFactor(f, SNAP.scale), centre: centreVec }
        break
      }
      case 'scale-axis': {
        const t = along(e.ray, d)
        if (t === null || Math.abs(d.t0) < 1e-6) return
        const f = Math.min(20, Math.max(0.05, t / d.t0))
        op = { kind: 'scale-axis', axis: d.what.axis, factor: free ? f : snapFactor(f, SNAP.scale), centre: centreVec, frame: { x: frame.x, y: frame.y, z: frame.z, w: frame.w } }
        break
      }
    }
    d.op = op
    useTableUi.getState().set({ propPreview: op ? applyGroupOp(d.poses, op) : null })
  }

  const end = (commit: boolean) => (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (commit) capture(e).releasePointerCapture(e.pointerId)
    drag.current = null
    if (controls) controls.enabled = true
    useTableUi.getState().set({ propPreview: null, editDrag: false })
    if (commit && d.op) commitGroupOp(d.op, onIntent, d.poses)
  }

  const events = (what: DragKind) => ({
    onPointerDown: begin(what), onPointerMove: move, onPointerUp: end(true),
    onPointerCancel: end(false), onLostPointerCapture: end(false),
  })

  const { wpp, ring, az } = m
  const line = LINE_PX * wpp
  const hitR = (hitPx / 2) * wpp
  const show = !dragging
  const alpha = (on: boolean) => (on ? 1 : 0.7)
  const arrowBase = Math.max(extent.top - c.y, 0) + 14 * wpp
  const arrowLen = ARROW_PX * wpp
  const cube = CUBE_PX * wpp
  const cubeAt = new Vector3(Math.sin(az + Math.PI / 4) * ring, 0, Math.cos(az + Math.PI / 4) * ring)
  const axisList: Axis[] = ['x', 'y', 'z']
  // Rings of the advanced gizmo: a torus lies in its XY plane, so turn it to face each axis.
  const ringTurn: Record<Axis, [number, number, number]> = { x: [0, Math.PI / 2, 0], y: [Math.PI / 2, 0, 0], z: [0, 0, 0] }
  const advRing = ring * 0.82
  const overlay = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const

  return (
    <group position={[c.x, c.y, c.z]} renderOrder={10}>
      {/* Turn ring on the floor */}
      <group rotation-x={Math.PI / 2}>
        <mesh visible={show} raycast={noRaycast} renderOrder={10}>
          <torusGeometry args={[ring, line, 6, 96]} />
          <meshBasicMaterial color={SELECT} opacity={alpha(mode === 'rotate')} {...overlay} />
        </mesh>
        <mesh {...events({ kind: 'yaw' })}>
          <torusGeometry args={[ring, hitR, 6, 48]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>

      {/* Height arrow */}
      <group position-y={arrowBase}>
        <mesh visible={show} position-y={arrowLen * 0.4} raycast={noRaycast} renderOrder={10}>
          <cylinderGeometry args={[line, line, arrowLen * 0.8, 8]} />
          <meshBasicMaterial color={AXIS_COLOR.y} opacity={alpha(mode === 'translate')} {...overlay} />
        </mesh>
        <mesh visible={show} position-y={arrowLen * 0.9} raycast={noRaycast} renderOrder={10}>
          <coneGeometry args={[line * 3.2, arrowLen * 0.3, 16]} />
          <meshBasicMaterial color={AXIS_COLOR.y} opacity={alpha(mode === 'translate')} {...overlay} />
        </mesh>
        <mesh position-y={arrowLen / 2} {...events({ kind: 'height' })}>
          <cylinderGeometry args={[hitR, hitR, arrowLen + hitR, 8]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>

      {/* Uniform scale cube on the ring, on the side facing the camera */}
      <group position={cubeAt}>
        <mesh visible={show} raycast={noRaycast} renderOrder={10}>
          <boxGeometry args={[cube, cube, cube]} />
          <meshBasicMaterial color={SELECT} opacity={alpha(mode === 'scale')} {...overlay} />
        </mesh>
        <mesh {...events({ kind: 'scale' })}>
          <sphereGeometry args={[Math.max(hitR, cube), 12, 8]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>

      {advanced && (
        <group quaternion={frame}>
          {axisList.map((axis) => (
            <group key={`ring-${axis}`} rotation={ringTurn[axis]}>
              <mesh visible={show} raycast={noRaycast} renderOrder={11}>
                <torusGeometry args={[advRing, line * 0.8, 6, 96]} />
                <meshBasicMaterial color={AXIS_COLOR[axis]} opacity={alpha(mode === 'rotate')} {...overlay} />
              </mesh>
              <mesh {...events({ kind: 'ring', axis })}>
                <torusGeometry args={[advRing, hitR * 0.8, 6, 48]} />
                <meshBasicMaterial visible={false} />
              </mesh>
            </group>
          ))}
          {axisList.map((axis) => {
            const d = AXES[axis]
            const reach = ring * 1.25
            return (
              <group key={`scale-${axis}`}>
                <mesh visible={show} position={[d.x * reach / 2, d.y * reach / 2, d.z * reach / 2]} rotation={axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]} raycast={noRaycast} renderOrder={11}>
                  <cylinderGeometry args={[line * 0.6, line * 0.6, reach, 6]} />
                  <meshBasicMaterial color={AXIS_COLOR[axis]} opacity={0.6} {...overlay} />
                </mesh>
                <group position={[d.x * reach, d.y * reach, d.z * reach]}>
                  <mesh visible={show} raycast={noRaycast} renderOrder={11}>
                    <boxGeometry args={[cube, cube, cube]} />
                    <meshBasicMaterial color={AXIS_COLOR[axis]} opacity={alpha(mode === 'scale')} {...overlay} />
                  </mesh>
                  <mesh {...events({ kind: 'scale-axis', axis })}>
                    <sphereGeometry args={[Math.max(hitR, cube), 12, 8]} />
                    <meshBasicMaterial visible={false} />
                  </mesh>
                </group>
              </group>
            )
          })}
        </group>
      )}
    </group>
  )
}
