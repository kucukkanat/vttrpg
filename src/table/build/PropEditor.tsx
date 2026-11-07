/**
 * Prop editing inside the canvas (GM): the gizmo, the power keys, copy / paste / duplicate, box
 * select on empty board in Build (mouse), the pointer's floor point for pastes, and the two-finger
 * twist / pinch on the selection (touch). Mounted once by TableCanvas.
 *
 * Keys (see transformKeys.ts for the full map) are active in Build or edit mode with a prop
 * selection, never while typing, and not while a build tool, the ruler or targeting is in use.
 * They are handled in the window's capture phase so a typed number cannot also open a panel (1-9)
 * or toggle zen (Z).
 *
 * Copy writes the internal clipboard and, through the browser's `copy` event, the system
 * clipboard as `vttprops:` text; paste reads the system clipboard's text from the `paste` event
 * (so it works across scenes and games), falling back to the internal clipboard.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Box3, Euler, Plane, Quaternion, Vector2, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { PropId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from '../context'
import { pingMissed } from '../PingLayer'
import { snapAngle, SNAP } from '../editing'
import { useTableUi, tableRuntime } from '../tableState'
import { capture } from '../TokenMesh'
import { useBuildUi } from './buildState'
import { BOX_THRESHOLD_PX, boxHits, rectAround, rectFrom, type ScreenRect } from './boxSelect'
import { editRuntime, isPhoneLike, propObjects } from './editRuntime'
import { applyGroupOp, snapFactor, updatesFrom, type Poses } from './groupTransform'
import {
  centreOf, commitGroupOp, copySelection, dropSelection, duplicateSelection, paste, removeSelection, selectionPoses, turnSelection,
} from './propActions'
import { PropGizmo } from './PropGizmo'
import { entryOp, propKeyAction } from './transformKeys'

function isTyping(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/** Whether the prop keys apply now (GM checked by the caller). */
function keysLive(): boolean {
  const ui = useTableUi.getState()
  return (ui.editMode || ui.buildMode) && !ui.targeting && !ui.tool && !useBuildUi.getState().tool
}

export function PropEditor() {
  const { viewer, loaded } = useTable()
  const gm = !viewer || viewer.isGm
  useEffect(() => { editRuntime.sceneRoot = loaded?.root ?? null; return () => { editRuntime.sceneRoot = null } }, [loaded])
  useCursorFloor()
  if (!gm) return null
  return (
    <>
      <PropKeys />
      <PropTouchGestures />
      <BoxSelectCatcher />
      <PropGizmo />
    </>
  )
}

/** Keeps `tableRuntime.cursorFloor` on the floor point under the pointer (pastes land there). */
function useCursorFloor() {
  const { floorY } = useTable()
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const raycaster = useThree((s) => s.raycaster)
  useEffect(() => {
    const el = gl.domElement
    const plane = new Plane(new Vector3(0, 1, 0), -floorY)
    const ndc = new Vector2()
    const out = new Vector3()
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      const ray = raycaster.ray.clone()
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.ray.intersectPlane(plane, out)
      raycaster.ray.copy(ray)
      tableRuntime.cursorFloor = hit ? { x: hit.x, y: floorY, z: hit.z } : null
    }
    const onLeave = () => { tableRuntime.cursorFloor = null }
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave)
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); tableRuntime.cursorFloor = null }
  }, [gl, camera, raycaster, floorY])
}

function PropKeys() {
  const { onIntent } = useTable()
  useEffect(() => {
    let pasteFallback: ReturnType<typeof setTimeout> | null = null
    let copyText: string | null = null

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement) || !keysLive()) return
      const g = useGame.getState()
      const ui = useTableUi.getState()
      const hasSelection = g.propSelection.length > 0
      const action = propKeyAction(e, { mode: ui.gizmoMode, entry: ui.transformEntry, hasSelection, advancedAllowed: !isPhoneLike() })
      if (!action) return
      // Copy and paste ride on the browser's copy / paste events (system clipboard access).
      if (action.type === 'copy') {
        if (window.getSelection()?.toString()) return // the user is copying page text
        copyText = copySelection()
        if (copyText) navigator.clipboard?.writeText(copyText).catch(() => {})
        return
      }
      if (action.type === 'paste') {
        if (pasteFallback) clearTimeout(pasteFallback)
        pasteFallback = setTimeout(() => {
          pasteFallback = null
          const read = navigator.clipboard?.readText?.()
          if (!read) { paste(onIntent); return }
          read.then((text) => paste(onIntent, text), () => paste(onIntent))
        }, 120)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      switch (action.type) {
        case 'mode': ui.set({ gizmoMode: action.mode }); break
        case 'entry': ui.set({ transformEntry: action.entry }); break
        case 'apply': {
          const poses = selectionPoses()
          const local = ui.advanced && ui.gizmoSpace === 'local'
          const primary = poses[g.propSelection[g.propSelection.length - 1]!]
          const frame = local && primary ? new Quaternion().setFromEuler(new Euler(primary.rotation.x, primary.rotation.y, primary.rotation.z, 'XYZ')) : null
          const op = entryOp(action.mode, action.axis, action.value, centreOf(poses), frame ? { x: frame.x, y: frame.y, z: frame.z, w: frame.w } : undefined)
          if (op) commitGroupOp(op, onIntent, poses)
          ui.set({ transformEntry: null })
          break
        }
        case 'turn': turnSelection(action.degrees, onIntent); break
        case 'drop': dropSelection(onIntent); break
        case 'remove': removeSelection(onIntent); ui.set({ transformEntry: null }); break
        case 'advanced': ui.set({ advanced: !ui.advanced }); break
        case 'deselect': g.clearPropSelection(); ui.set({ transformEntry: null }); break
        case 'duplicate': duplicateSelection(onIntent); break
      }
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!copyText || !e.clipboardData) return
      e.clipboardData.setData('text/plain', copyText)
      e.preventDefault()
      copyText = null
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement) || !keysLive()) return
      if (pasteFallback) { clearTimeout(pasteFallback); pasteFallback = null }
      const text = e.clipboardData?.getData('text/plain') ?? null
      if (paste(onIntent, text)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      if (pasteFallback) clearTimeout(pasteFallback)
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [onIntent])
  // Typing stops when the selection goes away.
  const hasSelection = useGame((s) => s.propSelection.length > 0)
  useEffect(() => { if (!hasSelection && useTableUi.getState().transformEntry) useTableUi.getState().set({ transformEntry: null }) }, [hasSelection])
  return null
}

// ------------------------------------------------------------- touch: twist and pinch

/**
 * Two fingers on the selection: twist turns it (15° steps unless Snap is off), pinch scales it
 * (0.05 steps), about its centre, committed as one `props.update` when a finger lifts. Only when
 * the first finger went down on a selected prop (`editRuntime.touchArm`); otherwise the camera
 * handles the gesture as usual.
 */
function PropTouchGestures() {
  const { onIntent } = useTable()
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  useEffect(() => {
    const el = gl.domElement
    const touches = new Map<number, { x: number; y: number }>()
    let g: { ids: [number, number]; angle0: number; dist0: number; poses: Poses; after: Poses | null } | null = null
    const pair = () => {
      if (!g) return null
      const a = touches.get(g.ids[0])
      const b = touches.get(g.ids[1])
      return a && b ? { angle: Math.atan2(b.y - a.y, b.x - a.x), dist: Math.hypot(b.x - a.x, b.y - a.y) } : null
    }
    const finish = (commit: boolean) => {
      if (!g) return
      const done = g
      g = null
      editRuntime.gestureActive = false
      editRuntime.gestureEndedAt = performance.now()
      editRuntime.touchArm = null
      if (controls) controls.enabled = true
      useTableUi.getState().set({ propPreview: null, editDrag: false })
      if (commit && done.after) {
        const updates = updatesFrom(done.poses, done.after)
        if (updates.length) onIntent({ type: 'props.update', updates })
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const arm = editRuntime.touchArm
      if (g || touches.size !== 2 || !arm || !touches.has(arm.pointerId) || !keysLiveTouch()) return
      const other = [...touches.keys()].find((id) => id !== arm.pointerId)!
      const poses = selectionPoses()
      if (!Object.keys(poses).length) return
      g = { ids: [arm.pointerId, other], angle0: 0, dist0: 0, poses, after: null }
      const p = pair()
      if (!p || p.dist < 10) { g = null; return }
      g.angle0 = p.angle
      g.dist0 = p.dist
      editRuntime.gestureActive = true
      if (controls) controls.enabled = false
      useTableUi.getState().set({ editDrag: true, propPreview: null })
    }
    const onMove = (e: PointerEvent) => {
      const t = touches.get(e.pointerId)
      if (!t) return
      t.x = e.clientX
      t.y = e.clientY
      if (!g || !g.ids.includes(e.pointerId)) return
      const p = pair()
      if (!p) return
      const snap = useTableUi.getState().snap
      // Screen y points down: a clockwise twist turns the props clockwise seen from above (negative yaw).
      let angle = -(p.angle - g.angle0)
      angle = Math.atan2(Math.sin(angle), Math.cos(angle))
      if (snap) angle = snapAngle(angle)
      let factor = Math.min(20, Math.max(0.05, p.dist / g.dist0))
      if (snap) factor = snapFactor(factor, SNAP.scale)
      const centre = centreOf(g.poses)
      let after = applyGroupOp(g.poses, { kind: 'rotate', axis: { x: 0, y: 1, z: 0 }, angle, centre })
      if (factor !== 1) after = applyGroupOp(after, { kind: 'scale', factor, centre })
      g.after = after
      useTableUi.getState().set({ propPreview: after })
    }
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId)
      if (g && g.ids.includes(e.pointerId)) finish(e.type === 'pointerup')
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', onMove, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onUp, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointermove', onMove, true)
      el.removeEventListener('pointerup', onUp, true)
      el.removeEventListener('pointercancel', onUp, true)
      finish(false)
    }
  }, [gl, controls, onIntent])
  return null
}

/** Twist and pinch need a selection being edited (Build or edit mode), not a tool. */
function keysLiveTouch(): boolean {
  return keysLive() && useGame.getState().propSelection.length > 0
}

// ------------------------------------------------------------- box select

/** Screen rectangle (relative to the canvas) of a prop's projected bounds. */
function projectedRect(prop: Prop, camera: THREE_Camera, w: number, h: number, cell: number): ScreenRect | null {
  const o = propObjects.get(prop.id)
  let box: Box3
  if (o) { o.updateWorldMatrix(true, true); box = new Box3().setFromObject(o, true) } else box = new Box3()
  if (box.isEmpty()) {
    // Not drawn on its own (instanced or still loading): a cell-sized box at its position.
    const half = cell * 0.3
    box = new Box3(new Vector3(prop.position.x - half, prop.position.y, prop.position.z - half), new Vector3(prop.position.x + half, prop.position.y + 2 * half, prop.position.z + half))
  }
  const pts: { x: number; y: number }[] = []
  const v = new Vector3()
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    v.set(x, y, z).project(camera)
    if (v.z < -1 || v.z > 1) continue // behind the camera or past the far plane
    pts.push({ x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h })
  }
  return rectAround(pts)
}
type THREE_Camera = Parameters<Vector3['project']>[0]

/**
 * Build mode, mouse: dragging on empty board draws a box and selects the props inside it (Shift
 * adds to the selection). A click on empty board deselects. Alt-drag and the other buttons still
 * move the camera. Not on phones, and not while a tool is out.
 */
function BoxSelectCatcher() {
  const { sceneId, grid, floorY } = useTable()
  const buildMode = useTableUi((s) => s.buildMode)
  const tool = useTableUi((s) => s.tool)
  const targeting = useTableUi((s) => s.targeting !== null)
  const buildTool = useBuildUi((s) => s.tool)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const press = useRef<{ pointerId: number; x: number; y: number; shift: boolean; moved: boolean; touch: boolean } | null>(null)
  const phone = useMemo(() => isPhoneLike(), [])
  if (!buildMode || tool || buildTool || targeting || phone) return null

  const local = (e: PointerEvent | MouseEvent) => {
    const r = gl.domElement.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const ne = e.nativeEvent
    if (e.button !== 0) return
    if (e.pointerType === 'touch' || ne.altKey) {
      // Touch (tablets) and Alt keep the camera; only a still tap on empty board deselects.
      const p = local(ne)
      press.current = { pointerId: e.pointerId, x: p.x, y: p.y, shift: false, moved: false, touch: true }
      return
    }
    e.stopPropagation()
    capture(e).setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const p = local(ne)
    press.current = { pointerId: e.pointerId, x: p.x, y: p.y, shift: ne.shiftKey, moved: false, touch: false }
    useTableUi.getState().set({ editDrag: true })
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const pr = press.current
    if (!pr || e.pointerId !== pr.pointerId) return
    const p = local(e.nativeEvent)
    if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) < BOX_THRESHOLD_PX) return
    pr.moved = true
    if (pr.touch) return
    e.stopPropagation()
    useTableUi.getState().set({ boxSelect: rectFrom(pr, p) })
  }
  const finish = (commit: boolean) => (e: ThreeEvent<PointerEvent>) => {
    const pr = press.current
    if (!pr || e.pointerId !== pr.pointerId) return
    press.current = null
    if (pr.touch) {
      if (commit && !pr.moved && !editRuntime.gestureActive) useGame.getState().setSelection(null)
      return
    }
    e.stopPropagation()
    if (controls) controls.enabled = true
    const box = useTableUi.getState().boxSelect
    useTableUi.getState().set({ boxSelect: null, editDrag: false })
    if (!commit) return
    const g = useGame.getState()
    if (!pr.moved || !box) {
      // A click on empty board: deselect (Shift keeps the selection), like a click on nothing.
      if (!pr.shift) g.setSelection(null)
      pingMissed(e.nativeEvent)
      return
    }
    const r = gl.domElement.getBoundingClientRect()
    const items: { id: PropId; rect: ScreenRect }[] = []
    for (const prop of Object.values(g.props)) {
      if (prop.scene !== sceneId) continue
      const rect = projectedRect(prop, camera, r.width, r.height, grid.cellSize)
      if (rect) items.push({ id: prop.id, rect })
    }
    const ids = boxHits(box, items)
    if (pr.shift) g.addPropsToSelection(ids)
    else g.setPropSelection(ids)
  }
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, floorY - 0.02, 0]}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={finish(true)} onPointerCancel={finish(false)} onLostPointerCapture={finish(false)}>
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}
