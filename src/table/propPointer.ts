/**
 * Pointer handling for props, shared by the standalone PropMesh and the instanced PropBatch:
 *
 * - tap selects (with Edit on or in edit mode it keeps the prop selected; otherwise it toggles), double tap
 *   enters or leaves edit mode; Shift-click (GM) adds the prop to the selection or drops it
 * - drag (GM, unlocked) moves the whole selection on the floor when the prop is part of it, else
 *   just this prop; snapped to half cells unless Snap is off or Alt is pressed during the drag
 * - Alt held when the press starts duplicates: the copies land where the drag ends, the originals stay
 * - right-click, or a still long-press on touch, opens the prop menu (GM; players just select)
 * - a finger on a selected prop arms the two-finger twist / pinch (build/PropEditor.tsx)
 * - GM with the Edit toggle off (`tableState.buildMode` false): props are not there for the pointer,
 *   so presses fall through to the board and the tokens beneath; only props with a click handler
 *   (a door, propClick.ts) keep the press, and a tap runs the handler. The handler runs on a tap
 *   with Edit on too, and for players.
 *
 * Drags preview through `tableState.propPreview` and commit one intent on release (one undo step).
 *
 * `resolve` names the prop under an event: PropMesh always answers its own id, PropBatch maps the
 * event's `instanceId` through its slot table. Everything else is read from the stores at event
 * time, so the handlers never go stale and a drag survives the prop switching renderers (a dragged
 * prop leaves its batch for a standalone mesh while the batch keeps the pointer capture).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { PropId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from './context'
import { snapTranslation } from './editing'
import { doubleTapEdit, tapTwice } from './editTap'
import { useTableUi } from './tableState'
import { propClickFor } from './propClick'
import { capture, DRAG_THRESHOLD_PX, LONG_PRESS_MS } from './TokenMesh'
import { editRuntime } from './build/editRuntime'
import { eyedrop, wantsEyedrop } from './build/eyedrop'
import { applyGroupOp, type Poses } from './build/groupTransform'
import { commitGroupOp, placeCopiesAt, posesOf } from './build/propActions'

type PropEvent = ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>

interface DragState {
  id: PropId
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  longPress: ReturnType<typeof setTimeout> | null
  plane: Plane
  offX: number
  offZ: number
  /** Alt was held at the press: the drag places copies. */
  duplicate: boolean
  /** Props that move, with their poses when the drag started. */
  group: Prop[]
  poses: Poses
  startedAt: number
}

export interface PropPointerHandlers {
  onPointerDown(e: ThreeEvent<PointerEvent>): void
  onPointerMove(e: ThreeEvent<PointerEvent>): void
  onPointerUp(e: ThreeEvent<PointerEvent>): void
  onPointerCancel(): void
  onLostPointerCapture(): void
  onContextMenu(e: ThreeEvent<MouseEvent>): void
  onPointerOver(e: ThreeEvent<PointerEvent>): void
  onPointerOut(e: ThreeEvent<PointerEvent>): void
}

export function usePropPointer(resolve: (e: PropEvent) => PropId | undefined, onHover: (id: PropId | null) => void): PropPointerHandlers {
  const { grid, floorY, viewer, onIntent } = useTable()
  const targeting = useTableUi((s) => s.targeting !== null)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const gm = !viewer || viewer.isGm
  const drag = useRef<DragState | null>(null)
  /** A press on a clickable prop (a door) while the GM's Edit toggle is off: a tap runs its handler. */
  const tap = useRef<{ id: PropId; pointerId: number; x: number; y: number } | null>(null)
  /** GM with Edit off: props ignore the pointer (doors still answer a click). */
  const passive = () => gm && !useTableUi.getState().buildMode
  const hit = useMemo(() => new Vector3(), [])

  const select = (id: PropId) => useGame.getState().setSelection({ kind: 'prop', id })
  const isSelected = (id: PropId) => useGame.getState().propSelection.includes(id)
  const openMenu = (id: PropId, x: number, y: number, radial: boolean) => {
    if (!isSelected(id)) select(id)
    useTableUi.getState().set({ propMenu: { prop: id, x, y, radial }, contextMenu: null })
  }

  const endDrag = useCallback((commit: boolean) => {
    const d = drag.current
    if (!d) return
    if (d.longPress) clearTimeout(d.longPress)
    drag.current = null
    if (editRuntime.touchArm?.pointerId === d.pointerId) editRuntime.touchArm = null
    if (controls) controls.enabled = true
    const preview = useTableUi.getState().propPreview
    useTableUi.getState().set({ editDrag: false, propPreview: null })
    if (!d.moved || !commit || !preview || editRuntime.gestureActive) return
    const after: Poses = {}
    for (const p of d.group) if (preview[p.id]) after[p.id] = preview[p.id]!
    if (d.duplicate) { placeCopiesAt(d.group, after, onIntent); return }
    const lead = after[d.id]
    const start = d.poses[d.id]
    if (!lead || !start) return
    commitGroupOp({ kind: 'move', delta: { x: lead.position.x - start.position.x, y: 0, z: lead.position.z - start.position.z } }, onIntent, d.poses)
  }, [controls, onIntent])

  // A drag that outlives the component (unmount mid-drag) leaves no preview behind.
  const endRef = useRef(endDrag)
  useEffect(() => { endRef.current = endDrag }, [endDrag])
  useEffect(() => () => endRef.current(false), [])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (targeting) return
    const id = resolve(e)
    const prop = id ? useGame.getState().props[id] : undefined
    if (!id || !prop) return
    const clicker = propClickFor(prop, gm)
    if (passive()) {
      // Not stopped: the press reaches the board and the tokens beneath, unless a door wants it.
      if (!clicker || e.button !== 0) return
      e.stopPropagation()
      tap.current = { id, pointerId: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
      return
    }
    e.stopPropagation()
    // A second finger while a twist / pinch runs belongs to the gesture.
    if (editRuntime.gestureActive || (e.pointerType === 'touch' && drag.current)) return
    const ne = e.nativeEvent
    if (e.button === 2) {
      if (gm) openMenu(id, ne.clientX, ne.clientY, false)
      else select(id)
      return
    }
    if (e.button !== 0) return
    // Shift-click: add to or drop from the selection (GM building with several props).
    if (gm && ne.shiftKey) { useGame.getState().togglePropSelected(id); return }
    if (!(gm && !prop.locked)) {
      // Alt-click is the eyedropper (pick this model up again); a locked prop cannot be dragged.
      if (gm && wantsEyedrop(ne)) { eyedrop(prop); return }
      if (clicker) clicker.click(prop, gm)
      const twice = tapTwice(`prop:${id}`, ne.clientX, ne.clientY)
      if (twice && doubleTapEdit(gm ? { kind: 'prop', id } : null)) return
      select(id)
      return
    }
    capture(e).setPointerCapture(e.pointerId)
    useTableUi.getState().set({ editDrag: true })
    const s = useGame.getState()
    const inSelection = s.propSelection.includes(id)
    const group = inSelection ? s.propSelection.map((pid) => s.props[pid]).filter((p): p is Prop => !!p && !p.locked) : [prop]
    const plane = new Plane(new Vector3(0, 1, 0), -Math.max(floorY, prop.position.y))
    const off = e.ray.intersectPlane(plane, hit) ? { x: hit.x - prop.position.x, z: hit.z - prop.position.z } : { x: 0, z: 0 }
    if (e.pointerType === 'touch' && inSelection) {
      // The camera stays put: this finger (and a second one) act on the selection.
      editRuntime.touchArm = { pointerId: e.pointerId, prop: id }
      if (controls) controls.enabled = false
    }
    drag.current = {
      id, pointerId: e.pointerId, startX: ne.clientX, startY: ne.clientY, moved: false,
      longPress: e.pointerType === 'touch'
        ? setTimeout(() => {
          if (!drag.current || drag.current.moved || editRuntime.gestureActive) return
          endDrag(false)
          if (gm) openMenu(id, ne.clientX, ne.clientY, true)
          else select(id)
        }, LONG_PRESS_MS)
        : null,
      plane, offX: off.x, offZ: off.z, duplicate: ne.altKey, group, poses: posesOf(group), startedAt: performance.now(),
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (editRuntime.gestureActive) {
      // A second finger took over: this drag gives way without committing.
      if (d.longPress) { clearTimeout(d.longPress); d.longPress = null }
      if (d.moved) { d.moved = false; useTableUi.getState().set({ propPreview: null }) }
      return
    }
    const ne = e.nativeEvent
    if (!d.moved) {
      if (Math.hypot(ne.clientX - d.startX, ne.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.moved = true
      if (d.longPress) { clearTimeout(d.longPress); d.longPress = null }
      if (controls) controls.enabled = false
      if (!isSelected(d.id)) select(d.id)
    }
    if (!e.ray.intersectPlane(d.plane, hit)) return
    const start = d.poses[d.id]
    if (!start) return
    let p = { x: hit.x - d.offX, y: start.position.y, z: hit.z - d.offZ }
    // Alt during the drag moves freely; the Alt that started a duplicate keeps snapping.
    const free = !useTableUi.getState().snap || (ne.altKey && !d.duplicate)
    if (!free) p = { ...snapTranslation(p, grid), y: start.position.y }
    const cur = useTableUi.getState().propPreview?.[d.id]
    if (cur && cur.position.x === p.x && cur.position.z === p.z) return
    const delta = { x: p.x - start.position.x, y: 0, z: p.z - start.position.z }
    useTableUi.getState().set({ propPreview: applyGroupOp(d.poses, { kind: 'move', delta }) })
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const t = tap.current
    if (t && e.pointerId === t.pointerId) {
      tap.current = null
      e.stopPropagation()
      const prop = useGame.getState().props[t.id]
      const still = Math.hypot(e.nativeEvent.clientX - t.x, e.nativeEvent.clientY - t.y) < DRAG_THRESHOLD_PX
      if (prop && still) propClickFor(prop, gm)?.click(prop, gm)
      return
    }
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).releasePointerCapture(e.pointerId)
    // A finger lifting after a twist / pinch is not a tap.
    const wasClick = !d.moved && !editRuntime.gestureActive && editRuntime.gestureEndedAt < d.startedAt
    const id = d.id
    endDrag(true)
    if (!wasClick) return
    const ne = e.nativeEvent
    // Alt-click without a drag is the eyedropper (Alt-drag duplicates).
    const dropped = d.duplicate && gm && wantsEyedrop({ altKey: true, button: 0 }) ? useGame.getState().props[id] : undefined
    if (dropped) { eyedrop(dropped); return }
    const clicked = useGame.getState().props[id]
    const clicker = clicked ? propClickFor(clicked, gm) : undefined
    if (clicked && clicker) clicker.click(clicked, gm)
    if (tapTwice(`prop:${id}`, ne.clientX, ne.clientY) && doubleTapEdit({ kind: 'prop', id })) return
    // With Edit on or edit mode a tap keeps the prop selected (the gizmo stays); otherwise it toggles.
    const ui = useTableUi.getState()
    if (ui.editMode || ui.buildMode) select(id)
    else useGame.getState().setSelection(isSelected(id) ? null : { kind: 'prop', id })
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => { tap.current = null; endDrag(false) },
    onLostPointerCapture: () => endDrag(false),
    onContextMenu: (e) => {
      if (targeting || passive()) return
      if (!resolve(e)) return
      e.stopPropagation()
      e.nativeEvent.preventDefault()
    },
    onPointerOver: (e) => {
      if (targeting) return
      const id = resolve(e)
      const prop = id ? useGame.getState().props[id] : undefined
      // Edit off: only a clickable prop (a door) lights up under the pointer.
      if (passive() && !(prop && propClickFor(prop, gm))) { onHover(null); return }
      e.stopPropagation()
      onHover(id ?? null)
    },
    onPointerOut: () => onHover(null),
  }
}
