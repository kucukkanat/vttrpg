/**
 * Pick up and stamp, on the table (reports/Level design plan.md, Phase 1 item 4). Mounted by
 * `BuildLayer` inside the canvas.
 *
 * - `PlaceLayer` (tool 'place'): a translucent ghost of the held model follows the cursor and rests
 *   on whatever is under it (a prop's top, else the floor), with an "on: Table" hint. R or the
 *   wheel turns it 15° (Shift: 90°) and the wheel does not zoom meanwhile; it snaps to the tray's
 *   step (half a cell by default), Alt is free. A click stamps one (one `props.place`, one undo
 *   step) and keeps holding; Esc or right-click puts it down. On touch a tap stamps where tapped.
 * - Tool 'eyedropper': the next prop clicked is picked up with its turn, tilt and scale (Alt-click
 *   on a prop does the same while building; that lives in propPointer.ts).
 * - `CardDrop`: a library card dragged onto the board places one where it is dropped.
 *
 * Props are found through `userData`: a standalone PropMesh group carries its `propId`, an
 * instanced PropBatch group its `propSlots` (instance id to prop id).
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Box3, Group, Material, Mesh, Object3D, Plane, Ray, Raycaster, Vector2, Vector3, type Camera, type Intersection } from 'three'
import type { Prop } from '@/core/doc'
import { newId, type PropId } from '@/core/ids'
import { useGame } from '@/state/store'
import { noteRecentlyPlaced } from '@/ui/library/libraryPrefs'
import { BUILD } from '@/ui/theme/palette'
import { useTable } from '../context'
import type { Bounds2 } from '../grid'
import { FloorCatcher, FloorLabel } from '../RulerLayer'
import { useAssetLoad } from '../TokenMesh'
import { useModel } from '../useModel'
import { nextRoll, putDownModel, useBuildUi } from './buildState'
import { eyedrop } from './eyedrop'
import { pickSurface, placedProp, snapPlacement, turnHeld, yawDegrees, type HeldModel, type SurfaceHit } from './placement'

const noRaycast = () => undefined
const DRAG_THRESHOLD_PX = 6
/** Wheel distance per 15° turn (a mouse notch is about 100; trackpads send many small deltas). */
const WHEEL_PER_STEP = 60
/** Height above a picked surface the second, downward ray starts from (metres). */
const DROP_FROM = 0.3
const DOWN = new Vector3(0, -1, 0)

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

interface PropUserData { propId?: unknown; propSlots?: { idAt(slot: number | undefined): string | undefined } }

/** The prop a ray hit belongs to: a PropMesh group's `propId`, or a PropBatch's instance slot. */
function propIdOf(hit: Pick<Intersection, 'object' | 'instanceId'>): string | undefined {
  for (let x: Object3D | null = hit.object; x; x = x.parent) {
    const d = x.userData as PropUserData
    if (typeof d.propId === 'string') return d.propId
    if (d.propSlots) return d.propSlots.idAt(hit.instanceId)
  }
  return undefined
}

/** The prop groups (standalone and instanced) under `root`, not descending into them. */
function propRoots(root: Object3D): Object3D[] {
  const out: Object3D[] = []
  const walk = (o: Object3D) => {
    const d = o.userData as PropUserData
    if (typeof d.propId === 'string' || d.propSlots) { out.push(o); return }
    for (const c of o.children) walk(c)
  }
  walk(root)
  return out
}

interface Picker {
  /** Where the held model would rest for a cursor ray. */
  rest(ray: Ray, free: boolean): { x: number; y: number; z: number; on: string } | null
  /** The prop under a cursor ray, if any. */
  propAt(ray: Ray): Prop | undefined
}

/** Raycasting against the props and the floor, shared by the ghost, the eyedropper and drops. */
function usePicker(): Picker {
  const scene = useThree((s) => s.scene)
  const { grid, floorY } = useTable()
  return useMemo(() => {
    const raycaster = new Raycaster()
    raycaster.layers.enableAll()
    const plane = new Plane(new Vector3(0, 1, 0), -floorY)
    const hitPoint = new Vector3()
    const origin = new Vector3()
    const normal = new Vector3()
    const toHits = (list: Intersection[]): SurfaceHit[] => {
      const props = useGame.getState().props
      return list.map((h) => {
        const propId = propIdOf(h)
        if (h.face) normal.copy(h.face.normal).transformDirection(h.object.matrixWorld)
        else normal.set(0, 1, 0)
        return { distance: h.distance, y: h.point.y, normalY: normal.y, propId, label: propId ? props[propId as PropId]?.name : undefined }
      })
    }
    const cast = () => raycaster.intersectObjects(propRoots(scene), true).filter((h) => (h.object as Mesh).isMesh && h.object.visible)
    return {
      rest(ray, free) {
        raycaster.ray.copy(ray)
        const hits = cast()
        const first = pickSurface(toHits(hits), floorY)
        // Where the cursor points: the surface it hit, else the floor plane.
        let px: number, pz: number
        const top = hits.find((h) => Math.abs(h.point.y - first.y) < 1e-6 && first.on !== 'floor')
        if (top) { px = top.point.x; pz = top.point.z }
        else if (ray.intersectPlane(plane, hitPoint)) { px = hitPoint.x; pz = hitPoint.z }
        else return null
        const ui = useBuildUi.getState()
        const at = snapPlacement({ x: px, z: pz }, grid, ui.snapCells, free)
        // Rest on what is under the snapped point: the same top, or the floor past its edge.
        origin.set(at.x, first.y + DROP_FROM, at.z)
        raycaster.set(origin, DOWN)
        const below = pickSurface(toHits(cast()), floorY)
        return { x: at.x, y: below.y, z: at.z, on: below.on }
      },
      propAt(ray) {
        raycaster.ray.copy(ray)
        const id = cast().map((h) => propIdOf(h)).find((x) => !!x)
        return id ? useGame.getState().props[id as PropId] : undefined
      },
    }
  }, [scene, grid, floorY])
}

/** Sends one stamp: one intent, one undo step; then the next scatter roll and Recently placed. */
function useStamp() {
  const { sceneId, viewer, onIntent } = useTable()
  return (held: HeldModel, at: { x: number; y: number; z: number }, yaw: number, useRoll = true) => {
    const ui = useBuildUi.getState()
    const prop = placedProp({
      id: newId<'PropId'>() as PropId, scene: sceneId, held, at, yaw,
      scatter: useRoll && ui.scatter ? ui.roll : undefined,
      createdBy: viewer?.pubkey,
    })
    onIntent({ type: 'props.place', props: [prop] })
    noteRecentlyPlaced(held.catalogue)
    ui.set({ roll: nextRoll(ui) })
  }
}

/** Whether Alt is held right now (free placement). */
function useAltKey() {
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Alt') setAlt(e.type === 'keydown') }
    const blur = () => setAlt(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', on); window.removeEventListener('keyup', on); window.removeEventListener('blur', blur) }
  }, [])
  return alt
}

export function PlaceLayer({ bounds, tool }: { bounds: Bounds2; tool: 'place' | 'eyedropper' }) {
  const held = useBuildUi((s) => s.held)
  const yaw = useBuildUi((s) => s.yaw)
  const roll = useBuildUi((s) => s.roll)
  const scatter = useBuildUi((s) => s.scatter)
  const gl = useThree((s) => s.gl)
  const picker = usePicker()
  const stamp = useStamp()
  const alt = useAltKey()
  const [hover, setHover] = useState<{ x: number; y: number; z: number; on: string } | null>(null)
  const [pointed, setPointed] = useState<Prop | undefined>(undefined)
  const press = useRef<{ id: number; x: number; y: number } | null>(null)
  const lastRay = useRef<Ray | null>(null)
  const placing = tool === 'place' && !!held

  // Keys while holding: Esc puts it down, R / Shift+R turn it. Capture phase, so the table's own
  // R (turn the selection) does not also fire while a model is in hand.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.key === 'Escape') { e.stopImmediatePropagation(); putDownModel(); return }
      if (e.code === 'KeyR' && placing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const s = useBuildUi.getState()
        s.set({ yaw: turnHeld(s.yaw, 1, e.shiftKey) })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [placing])

  // The wheel turns the held model instead of zooming the camera.
  useEffect(() => {
    if (!placing) return
    const el = gl.domElement
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Node) || !el.parentElement?.contains(e.target)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      acc += e.deltaY || e.deltaX
      if (Math.abs(acc) < WHEEL_PER_STEP) return
      const dir = acc > 0 ? 1 : -1
      acc = 0
      const s = useBuildUi.getState()
      s.set({ yaw: turnHeld(s.yaw, dir, e.shiftKey) })
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [placing, gl])

  // Alt pressed or released while still: re-snap where the cursor already is.
  useEffect(() => {
    if (placing && lastRay.current) setHover(picker.rest(lastRay.current, alt))
  }, [alt, placing, picker])

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    lastRay.current = e.ray.clone()
    if (tool === 'eyedropper') { setPointed(picker.propAt(e.ray)); return }
    if (placing) setHover(picker.rest(e.ray, e.nativeEvent.altKey))
  }
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) { e.stopPropagation(); putDownModel(); return }
    if (e.button !== 0) return
    press.current = { id: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const p = press.current
    press.current = null
    if (!p || p.id !== e.pointerId) return
    // A drag moved the camera; only a still click stamps.
    if (Math.hypot(e.nativeEvent.clientX - p.x, e.nativeEvent.clientY - p.y) >= DRAG_THRESHOLD_PX) return
    e.stopPropagation()
    if (tool === 'eyedropper') {
      const prop = picker.propAt(e.ray)
      if (prop) eyedrop(prop)
      return
    }
    const s = useBuildUi.getState()
    if (!s.held) return
    const at = picker.rest(e.ray, e.nativeEvent.altKey)
    if (!at) return
    stamp(s.held, at, s.yaw)
    setHover(picker.rest(e.ray, e.nativeEvent.altKey))
  }

  return (
    <group>
      <FloorCatcher bounds={bounds} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null }} />
      {placing && hover && held && (
        <Ghost held={held} at={hover} yaw={yaw + (scatter ? roll.yaw : 0)} k={scatter ? roll.scale : 1} />
      )}
      {placing && hover && held && (
        <FloorLabel x={hover.x} y={hover.y + 0.05} z={hover.z} color={BUILD.proposal}>
          on: {hover.on} · {yawDegrees(yaw)}°{alt ? ' · free' : ''}
        </FloorLabel>
      )}
      {tool === 'eyedropper' && pointed && (
        <FloorLabel x={pointed.position.x} y={pointed.position.y + 0.05} z={pointed.position.z} color={BUILD.proposal}>
          pick up: {pointed.name}
        </FloorLabel>
      )}
    </group>
  )
}

/** The held model, translucent, where a click would put it. */
function Ghost({ held, at, yaw, k }: { held: HeldModel; at: { x: number; y: number; z: number }; yaw: number; k: number }) {
  const { url } = useAssetLoad(held.model)
  const s = held.scale
  return (
    <group position={[at.x, at.y, at.z]} rotation={[held.tilt?.x ?? 0, yaw, held.tilt?.z ?? 0]}>
      <group scale={[s.x * k, s.y * k, s.z * k]}>
        {url ? (
          <Suspense fallback={<SizeBox size={held.size} />}>
            <GhostModel url={url} sha256={held.model.sha256} name={held.title} />
          </Suspense>
        ) : <SizeBox size={held.size} />}
      </group>
    </group>
  )
}

/** A wire box of the catalogue size while the model loads. */
function SizeBox({ size }: { size?: [number, number, number] }) {
  const [w, h, d] = size ?? [0.6, 0.6, 0.6]
  return (
    <mesh position-y={h / 2} raycast={noRaycast}>
      <boxGeometry args={[w, h, d]} />
      <meshBasicMaterial color={BUILD.proposal} wireframe transparent opacity={0.7} />
    </mesh>
  )
}

const GHOST_OPACITY = 0.55

function GhostModel({ url, sha256, name }: { url: string; sha256: string; name: string }) {
  const gltf = useModel(url, sha256, name)
  const { object, materials, footprint } = useMemo(() => {
    const o = gltf.scene.clone(true) as Group
    const mats: Material[] = []
    o.traverse((m) => {
      if (!(m instanceof Mesh)) return
      if (/^(COL|FOG)_/.test(m.name)) { m.visible = false; return }
      m.raycast = noRaycast
      m.castShadow = false
      const ghost = (src: Material) => {
        const c = src.clone()
        c.transparent = true
        c.opacity = GHOST_OPACITY * (src.opacity ?? 1)
        c.depthWrite = false
        mats.push(c)
        return c
      }
      m.material = Array.isArray(m.material) ? m.material.map(ghost) : ghost(m.material)
    })
    const box = new Box3().setFromObject(o)
    const fp = box.isEmpty() ? null : { w: box.max.x - box.min.x, d: box.max.z - box.min.z, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2 }
    return { object: o, materials: mats, footprint: fp }
  }, [gltf])
  useEffect(() => () => { for (const m of materials) m.dispose() }, [materials])
  return (
    <>
      <primitive object={object} />
      {footprint && (
        <mesh rotation-x={-Math.PI / 2} position={[footprint.cx, 0.01, footprint.cz]} raycast={noRaycast} renderOrder={21}>
          <planeGeometry args={[footprint.w, footprint.d]} />
          <meshBasicMaterial color={BUILD.proposal} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
    </>
  )
}

/** A cursor ray from client coordinates on the canvas. */
function rayAt(camera: Camera, el: HTMLElement, clientX: number, clientY: number, raycaster: Raycaster): Ray {
  const r = el.getBoundingClientRect()
  const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.ray
}

/** Drop target for library cards dragged onto the board: places one where it lands. */
export function CardDrop() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const picker = usePicker()
  const stamp = useStamp()
  const stampRef = useRef(stamp)
  stampRef.current = stamp
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new Raycaster()
    const over = (e: DragEvent) => {
      if (!useBuildUi.getState().dragging) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      const held = useBuildUi.getState().dragging
      if (!held) return
      e.preventDefault()
      useBuildUi.getState().set({ dragging: null })
      const at = picker.rest(rayAt(camera, el, e.clientX, e.clientY, raycaster), e.altKey)
      if (at) stampRef.current(held, at, 0, false)
    }
    el.addEventListener('dragover', over)
    el.addEventListener('drop', drop)
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('drop', drop) }
  }, [gl, camera, picker])
  return null
}
