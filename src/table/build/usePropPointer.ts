/**
 * Pointer handling of one prop on the table (spread on the prop's root group):
 *
 * - tap selects (in Build or edit mode it keeps the prop selected; otherwise it toggles), double tap
 *   enters or leaves edit mode; Shift-click (GM) adds the prop to the selection or drops it
 * - drag (GM, unlocked) moves the whole selection on the floor when the prop is part of it, else
 *   just this prop; snapped to half cells unless Snap is off or Alt is pressed during the drag
 * - Alt held when the press starts duplicates: the copies land where the drag ends, the originals stay
 * - right-click, or a still long-press on touch, opens the prop menu (GM; players just select)
 * - a finger on a selected prop arms the two-finger twist / pinch (`PropTouchGestures`)
 *
 * Every drag commits one intent on release (one undo step); the preview goes through
 * `tableState.propPreview`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { snapTranslation } from '../editing'
import { doubleTapEdit, tapTwice } from '../editTap'
import { useTableUi } from '../tableState'
import { capture, DRAG_THRESHOLD_PX, LONG_PRESS_MS } from '../TokenMesh'
import { editRuntime } from './editRuntime'
import { applyGroupOp, type Poses } from './groupTransform'
import { commitGroupOp, placeCopiesAt, posesOf } from './propActions'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  longPress: ReturnType<typeof setTimeout> | null
  plane: Plane
  offX: number
  offZ: number
  duplicate: boolean
  /** Props that move, with their poses when the drag started. */
  group: Prop[]
  poses: Poses
}

export interface PropPointerOptions {
  prop: Prop
  gm: boolean
  grid: GridSpec
  floorY: number
  onIntent(intent: Intent): void
}

export function usePropPointer({ prop, gm, grid, floorY, onIntent }: PropPointerOptions) {
  const selected = useGame((s) => s.propSelection.includes(prop.id))
  const targeting = useTableUi((s) => s.targeting !== null)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const drag = useRef<DragState | null>(null)
  const hit = useMemo(() => new Vector3(), [])
  const draggable = gm && !prop.locked

  const select = useCallback(() => useGame.getState().setSelection({ kind: 'prop', id: prop.id }), [prop.id])
  const openMenu = useCallback((x: number, y: number, radial: boolean) => {
    if (!useGame.getState().propSelection.includes(prop.id)) select()
    useTableUi.getState().set({ propMenu: { prop: prop.id, x, y, radial }, contextMenu: null })
  }, [prop.id, select])

  const endDrag = (commit: boolean) => {
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
    const lead = after[prop.id]
    const start = d.poses[prop.id]
    if (!lead || !start) return
    commitGroupOp({ kind: 'move', delta: { x: lead.position.x - start.position.x, y: 0, z: lead.position.z - start.position.z } }, onIntent, d.poses)
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (targeting) return
    e.stopPropagation()
    const ne = e.nativeEvent
    if (e.button === 2) {
      if (gm) openMenu(ne.clientX, ne.clientY, false)
      else select()
      return
    }
    if (e.button !== 0) return
    // Shift-click: add to or drop from the selection (GM builds with several props).
    if (gm && ne.shiftKey) { useGame.getState().togglePropSelected(prop.id); return }
    if (!draggable) {
      const twice = tapTwice(`prop:${prop.id}`, ne.clientX, ne.clientY)
      if (twice && doubleTapEdit(gm ? { kind: 'prop', id: prop.id } : null)) return
      select()
      return
    }
    capture(e).setPointerCapture(e.pointerId)
    useTableUi.getState().set({ editDrag: true })
    const s = useGame.getState()
    const inSelection = s.propSelection.includes(prop.id)
    const group = (inSelection ? s.propSelection.map((id) => s.props[id]).filter((p): p is Prop => !!p && !p.locked) : [prop])
    const plane = new Plane(new Vector3(0, 1, 0), -Math.max(floorY, prop.position.y))
    const off = e.ray.intersectPlane(plane, hit) ? { x: hit.x - prop.position.x, z: hit.z - prop.position.z } : { x: 0, z: 0 }
    if (e.pointerType === 'touch' && inSelection) {
      // The camera stays put: this finger (and a second one) acts on the selection.
      editRuntime.touchArm = { pointerId: e.pointerId, prop: prop.id }
      if (controls) controls.enabled = false
    }
    drag.current = {
      pointerId: e.pointerId, startX: ne.clientX, startY: ne.clientY, moved: false,
      longPress: e.pointerType === 'touch' && gm
        ? setTimeout(() => { if (drag.current && !drag.current.moved && !editRuntime.gestureActive) { endDrag(false); openMenu(ne.clientX, ne.clientY, true) } }, LONG_PRESS_MS)
        : null,
      plane, offX: off.x, offZ: off.z, duplicate: ne.altKey, group, poses: posesOf(group),
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
      if (!useGame.getState().propSelection.includes(prop.id)) select()
    }
    if (!e.ray.intersectPlane(d.plane, hit)) return
    const start = d.poses[prop.id]
    if (!start) return
    let p = { x: hit.x - d.offX, y: start.position.y, z: hit.z - d.offZ }
    // Alt during the drag moves freely; Alt that started a duplicate keeps snapping.
    const free = !useTableUi.getState().snap || (ne.altKey && !d.duplicate)
    if (!free) p = { ...snapTranslation(p, grid), y: start.position.y }
    const delta = { x: p.x - start.position.x, y: 0, z: p.z - start.position.z }
    const cur = useTableUi.getState().propPreview?.[prop.id]
    if (cur && cur.position.x === p.x && cur.position.z === p.z) return
    useTableUi.getState().set({ propPreview: applyGroupOp(d.poses, { kind: 'move', delta }) })
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).releasePointerCapture(e.pointerId)
    const wasClick = !d.moved && !editRuntime.gestureActive
    endDrag(true)
    if (!wasClick) return
    const ne = e.nativeEvent
    if (tapTwice(`prop:${prop.id}`, ne.clientX, ne.clientY) && doubleTapEdit({ kind: 'prop', id: prop.id })) return
    // In Build or edit mode a tap keeps the prop selected (the gizmo stays); otherwise it toggles.
    const ui = useTableUi.getState()
    if (ui.editMode || ui.buildMode) select()
    else useGame.getState().setSelection(selected ? null : { kind: 'prop', id: prop.id })
  }

  useEffect(() => () => { if (drag.current) endDrag(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    if (targeting) return
    e.stopPropagation()
    e.nativeEvent.preventDefault()
  }

  return {
    selected,
    draggable,
    handlers: {
      onPointerDown, onPointerMove, onPointerUp, onContextMenu,
      onPointerCancel: () => endDrag(false),
      onLostPointerCapture: () => endDrag(false),
    },
  }
}
