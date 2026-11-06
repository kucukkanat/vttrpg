/**
 * Two camera modes with smooth transitions:
 *  - orbit: drei OrbitControls, clamped so the camera never goes under the floor
 *  - token: third-person shoulder camera following a token; F toggles first person.
 * In token mode a drag on empty space turns the camera, the wheel / pinch changes distance.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Box3, MathUtils, MOUSE, TOUCH, Vector3, type Camera, type PerspectiveCamera } from 'three'
import type { CameraMode, Token } from '@/core/doc'
import { useGame } from '@/state/store'
import { tableRuntime, useTableUi } from './tableState'
import { castRay, type WallSegment } from './walls'

export interface CameraRigProps {
  mode: CameraMode
  /** Token the shoulder camera follows; null falls back to orbit behaviour. */
  follow: Token | null
  bounds: Box3
  floorY: number
  cellSize: number
  /** Walls the shoulder camera must not pass through. */
  walls: readonly WallSegment[]
}

interface RigState {
  target: Vector3
  yaw: number
  pitch: number
  dist: number
  orbitPose: { pos: Vector3; target: Vector3 } | null
  settled: boolean
  lastMode: CameraMode | null
  lastFollow: string | null
}

const tmpDest = new Vector3()
const tmpLook = new Vector3()
const tmpDir = new Vector3()

/** Frames the whole floor from ~50° above, far enough for both the vertical and horizontal FOV. */
function overviewPose(bounds: Box3, floorY: number, camera?: Camera): { pos: Vector3; target: Vector3 } {
  const c = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const target = new Vector3(c.x, floorY, c.z)
  const w = Math.max(size.x, 4)
  const d = Math.max(size.z, 4)
  const pitch = (50 * Math.PI) / 180
  let dist: number
  if (camera && 'isPerspectiveCamera' in camera && (camera as PerspectiveCamera).isPerspectiveCamera) {
    const pc = camera as PerspectiveCamera
    const vfov = (pc.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * pc.aspect)
    // Depth of the floor as seen at this pitch projects onto the vertical axis by sin(pitch).
    const needV = (d * Math.sin(pitch)) / 2 / Math.tan(vfov / 2)
    const needH = w / 2 / Math.tan(hfov / 2)
    dist = Math.max(needV, needH) * 1.15 + d * 0.25
  } else {
    dist = Math.max(w, d) * 1.2
  }
  const pos = new Vector3(c.x, floorY + dist * Math.sin(pitch), c.z + dist * Math.cos(pitch))
  return { pos, target }
}

export function CameraRig({ mode, follow, bounds, floorY, cellSize, walls }: CameraRigProps) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useRef<OrbitControlsImpl>(null)
  const firstPerson = useTableUi((s) => s.firstPerson)
  // Token drags, prop drags and gizmo handles all own the pointer while they last.
  const dragging = useTableUi((s) => s.drag !== null || s.editDrag)
  const effectiveMode: CameraMode = mode === 'token' && follow ? 'token' : 'orbit'
  // Mirrors rig.settled so OrbitControls re-renders when the transition finishes.
  const [orbitReady, setOrbitReady] = useState(false)

  const rig = useRef<RigState>({
    target: new Vector3(), yaw: 0, pitch: 0.42, dist: 3 * cellSize, orbitPose: null, settled: false, lastMode: null, lastFollow: null,
  })

  // Tell the HUD what the rig is doing (the pill highlights the effective mode, not the request).
  useEffect(() => {
    useTableUi.getState().set({ cameraActive: { mode: effectiveMode, canFollow: follow !== null } })
  }, [effectiveMode, follow])
  useEffect(() => () => useTableUi.getState().set({ cameraActive: null }), [])

  // "Find me": frame the token in orbit mode, keeping the current viewing direction. In token mode
  // the request is already satisfied by the selection switching the follow target.
  const focusRequest = useTableUi((s) => s.focusRequest)
  useEffect(() => {
    if (!focusRequest) return
    useTableUi.getState().set({ focusRequest: undefined })
    const game = useGame.getState()
    const token = game.tokens[focusRequest.id]
    if (!token || token.scene !== game.meta?.activeScene || effectiveMode !== 'orbit') return
    const r = rig.current
    const from = controls.current?.target ?? r.target
    const target = new Vector3(token.position.x, floorY + (token.elevation ?? 0), token.position.z)
    const dir = camera.position.clone().sub(from)
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1)
    dir.normalize()
    // Look down at ~30° or steeper so walls between the camera and the token do not hide it.
    if (dir.y < 0.5) { dir.y = 0.5; dir.normalize() }
    const dist = 4 * cellSize * Math.max(1, token.scale)
    r.orbitPose = { pos: target.clone().addScaledVector(dir, dist), target }
    r.settled = false
    setOrbitReady(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  // Mode / follow-target changes start a transition.
  useEffect(() => {
    const r = rig.current
    if (r.lastMode === 'orbit' && effectiveMode === 'token') {
      r.orbitPose = { pos: camera.position.clone(), target: controls.current?.target.clone() ?? r.target.clone() }
    }
    if (effectiveMode === 'token' && follow && (r.lastMode !== 'token' || r.lastFollow !== follow.id)) {
      // start behind the token (+Z local is its back)
      r.yaw = follow.rotationY
      r.pitch = 0.42
      r.dist = 3 * cellSize * Math.max(0.6, follow.scale)
    }
    if (r.lastMode !== effectiveMode || (follow && r.lastFollow !== follow.id)) { r.settled = false; setOrbitReady(false) }
    r.lastMode = effectiveMode
    r.lastFollow = follow?.id ?? null
  }, [effectiveMode, follow, camera, cellSize])

  // Initial overview on mount.
  useEffect(() => {
    const r = rig.current
    if (r.orbitPose) return
    const pose = overviewPose(bounds, floorY, camera)
    camera.position.copy(pose.pos)
    r.target.copy(pose.target)
    camera.lookAt(pose.target)
    controls.current?.target.copy(pose.target)
    controls.current?.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-frame when the real scene bounds arrive (the mount pose used placeholder bounds).
  const lastBounds = useRef<string>('')
  useEffect(() => {
    const key = `${bounds.min.x},${bounds.min.z},${bounds.max.x},${bounds.max.z},${floorY}`
    if (lastBounds.current === '') { lastBounds.current = key; return }
    if (lastBounds.current === key) return
    lastBounds.current = key
    if (effectiveMode !== 'orbit') return
    const pose = overviewPose(bounds, floorY, camera)
    camera.position.copy(pose.pos)
    rig.current.target.copy(pose.target)
    camera.lookAt(pose.target)
    controls.current?.target.copy(pose.target)
    controls.current?.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, floorY])

  // Token-mode input: drag on empty space turns the camera; wheel / pinch zooms.
  useEffect(() => {
    if (effectiveMode !== 'token') return
    const el = gl.domElement
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch = 0
    const r = rig.current
    const onDown = (e: PointerEvent) => {
      const ui = useTableUi.getState()
      if (ui.grab || ui.editDrag) return // a token / prop drag or a gizmo handle is starting
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      }
    }
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      if (pointers.size === 1) {
        r.yaw -= dx * 0.006
        r.pitch = MathUtils.clamp(r.pitch - dy * 0.004, -0.3, 1.2)
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinch > 0) r.dist = MathUtils.clamp(r.dist * (pinch / d), 1.2 * cellSize, 10 * cellSize)
        pinch = d
      }
    }
    const onUp = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0 }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      r.dist = MathUtils.clamp(r.dist * (1 + e.deltaY * 0.0015), 1.2 * cellSize, 10 * cellSize)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [effectiveMode, gl, cellSize])

  const controlsEnabled = effectiveMode === 'orbit' && orbitReady && !dragging
  useFrame((_, dt) => {
    const r = rig.current
    const c = controls.current
    // Gizmo handles flip `controls.enabled` imperatively on their own; keep the React value authoritative.
    if (c && c.enabled !== controlsEnabled && !dragging) c.enabled = controlsEnabled
    const look = c && effectiveMode === 'orbit' ? c.target : r.target
    tableRuntime.cameraTarget = { x: look.x, y: look.y, z: look.z }
    const step = 1 - Math.exp(-dt * (r.settled ? 10 : 4))
    if (effectiveMode === 'orbit') {
      if (!r.settled) {
        const pose = r.orbitPose ?? overviewPose(bounds, floorY, camera)
        camera.position.lerp(pose.pos, step)
        r.target.lerp(pose.target, step)
        camera.lookAt(r.target)
        if (camera.position.distanceTo(pose.pos) < 0.02 * cellSize) {
          r.settled = true
          camera.position.copy(pose.pos)
          r.target.copy(pose.target)
          if (c) { c.target.copy(pose.target); c.update() }
          setOrbitReady(true)
        }
      } else if (c) {
        // never under the floor
        const minY = floorY + 0.25 * cellSize
        if (camera.position.y < minY) camera.position.y = minY
        if (c.target.y < floorY) c.target.y = floorY
      }
      return
    }
    if (!follow) return
    const base = tmpLook.set(follow.position.x, floorY, follow.position.z)
    const eye = 1.1 * cellSize * Math.max(0.5, follow.scale)
    tmpDir.set(Math.sin(r.yaw) * Math.cos(r.pitch), Math.sin(r.pitch), Math.cos(r.yaw) * Math.cos(r.pitch))
    if (firstPerson) {
      tmpDest.copy(base).y += eye
      // look where the camera faces; pitch flipped so dragging down looks down
      const look = tmpDir.clone().multiplyScalar(-1)
      look.y = -Math.sin(r.pitch) * 0.6
      camera.position.lerp(tmpDest, step)
      r.target.lerp(tmpDest.clone().add(look.multiplyScalar(5)), step)
    } else {
      tmpDest.copy(base).addScaledVector(tmpDir, r.dist)
      // pull the camera in front of any wall between the token and the desired spot
      const hit = castRay({ x: base.x, z: base.z }, { x: tmpDest.x, z: tmpDest.z }, walls)
      if (hit < 1) {
        const f = Math.max(0.12, hit - (0.35 * cellSize) / r.dist)
        tmpDest.x = base.x + (tmpDest.x - base.x) * f
        tmpDest.z = base.z + (tmpDest.z - base.z) * f
      }
      tmpDest.y += eye * 0.9
      if (tmpDest.y < floorY + 0.2 * cellSize) tmpDest.y = floorY + 0.2 * cellSize
      camera.position.lerp(tmpDest, step)
      r.target.lerp(base.clone().setY(floorY + eye * 0.7), step)
    }
    camera.lookAt(r.target)
    if (!r.settled && camera.position.distanceTo(tmpDest) < 0.02 * cellSize) r.settled = true
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={controlsEnabled}
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.08}
      minDistance={cellSize}
      maxDistance={80}
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    />
  )
}
