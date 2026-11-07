/**
 * Pointer handling for props, shared by the standalone PropMesh and the instanced PropBatch: tap
 * selects, double tap enters edit mode, right-click selects, and the GM drags unlocked props on the
 * floor, previewed through `editPreview` and committed as one `props.update` on release.
 *
 * `resolve` names the prop under an event: PropMesh always answers its own id, PropBatch maps the
 * event's `instanceId` through its slot table. Everything else is read from the stores at event
 * time, so the handlers never go stale and a drag survives the prop switching renderers (a dragged
 * prop leaves its batch for a standalone mesh while the batch keeps the pointer capture).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import type { PropId } from '@/core/ids'
import { propScale, uniformScale } from '@/core/props'
import { useGame } from '@/state/store'
import { useTable } from './context'
import { snapTranslation } from './editing'
import { doubleTapEdit, tapTwice } from './editTap'
import { knownLegacyFit } from './propMigration'
import { useTableUi } from './tableState'
import { capture, DRAG_THRESHOLD_PX, LONG_PRESS_MS } from './TokenMesh'
import { eyedrop, wantsEyedrop } from './build/eyedrop'

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
  const snap = useTableUi((s) => s.snap)
  const uiSet = useTableUi((s) => s.set)
  const setSelection = useGame((s) => s.setSelection)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const gm = !viewer || viewer.isGm
  const drag = useRef<DragState | null>(null)
  const hit = useMemo(() => new Vector3(), [])

  const isSelected = (id: PropId) => {
    const sel = useGame.getState().selection
    return sel?.kind === 'prop' && sel.id === id
  }
  const toggleSelect = (id: PropId) => setSelection(isSelected(id) ? null : { kind: 'prop', id })

  const endDrag = useCallback((commit: boolean) => {
    const d = drag.current
    if (!d) return
    if (d.longPress) clearTimeout(d.longPress)
    drag.current = null
    if (controls) controls.enabled = true
    const pv = useTableUi.getState().editPreview
    uiSet({ editDrag: false, editPreview: null })
    if (!d.moved) return
    const prop = useGame.getState().props[d.id]
    if (commit && prop && pv && pv.target.kind === 'prop' && pv.target.id === d.id) {
      const p = pv.position
      if (Math.abs(p.x - prop.position.x) > 1e-4 || Math.abs(p.z - prop.position.z) > 1e-4) {
        onIntent({ type: 'props.update', updates: [{ id: d.id, patch: { position: { x: p.x, y: prop.position.y, z: p.z } } }] })
      }
    }
  }, [controls, uiSet, onIntent])

  // A drag that outlives the component (unmount mid-drag) leaves no preview behind.
  const endRef = useRef(endDrag)
  useEffect(() => { endRef.current = endDrag }, [endDrag])
  useEffect(() => () => endRef.current(false), [])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (targeting) return
    const id = resolve(e)
    const prop = id ? useGame.getState().props[id] : undefined
    if (!id || !prop) return
    e.stopPropagation()
    // Build: Alt-click is the eyedropper (pick this model up again).
    if (gm && wantsEyedrop(e.nativeEvent)) { eyedrop(prop); return }
    if (e.button === 2) { setSelection({ kind: 'prop', id }); return }
    if (e.button !== 0) return
    if (!(gm && !prop.locked)) {
      const twice = tapTwice(`prop:${id}`, e.nativeEvent.clientX, e.nativeEvent.clientY)
      if (twice && doubleTapEdit(gm ? { kind: 'prop', id } : null)) return
      setSelection({ kind: 'prop', id })
      return
    }
    capture(e).setPointerCapture(e.pointerId)
    uiSet({ editDrag: true })
    const plane = new Plane(new Vector3(0, 1, 0), -Math.max(floorY, prop.position.y))
    const off = e.ray.intersectPlane(plane, hit) ? { x: hit.x - prop.position.x, z: hit.z - prop.position.z } : { x: 0, z: 0 }
    drag.current = {
      id, pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false,
      longPress: e.pointerType === 'touch' ? setTimeout(() => { if (drag.current && !drag.current.moved) { toggleSelect(id); endDrag(false) } }, LONG_PRESS_MS) : null,
      plane, offX: off.x, offZ: off.z,
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    const prop = useGame.getState().props[d.id]
    if (!prop) { endDrag(false); return }
    if (!d.moved) {
      if (Math.hypot(e.nativeEvent.clientX - d.startX, e.nativeEvent.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.moved = true
      if (d.longPress) { clearTimeout(d.longPress); d.longPress = null }
      if (controls) controls.enabled = false
      if (!isSelected(d.id)) setSelection({ kind: 'prop', id: d.id })
    }
    if (!e.ray.intersectPlane(d.plane, hit)) return
    let p = { x: hit.x - d.offX, y: prop.position.y, z: hit.z - d.offZ }
    if (snap && !e.nativeEvent.altKey) p = { ...snapTranslation(p, grid), y: prop.position.y }
    const cur = useTableUi.getState().editPreview
    if (cur && cur.target.kind === 'prop' && cur.target.id === d.id && cur.position.x === p.x && cur.position.z === p.z) return
    const base = propScale(prop, knownLegacyFit(d.id) ?? 1)
    uiSet({ editPreview: { target: { kind: 'prop', id: d.id }, position: p, rotationY: prop.rotation.y, scale: uniformScale(base), scaleVec: base } })
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).releasePointerCapture(e.pointerId)
    const wasClick = !d.moved
    const id = d.id
    endDrag(true)
    if (!wasClick) return
    if (tapTwice(`prop:${id}`, e.nativeEvent.clientX, e.nativeEvent.clientY) && doubleTapEdit({ kind: 'prop', id })) return
    // In edit mode a tap keeps the prop selected (the gizmo stays); otherwise it toggles.
    if (useTableUi.getState().editMode) setSelection({ kind: 'prop', id })
    else toggleSelect(id)
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => endDrag(false),
    onLostPointerCapture: () => endDrag(false),
    onContextMenu: (e) => {
      if (targeting) return
      const id = resolve(e)
      if (!id) return
      e.stopPropagation()
      e.nativeEvent.preventDefault()
      setSelection({ kind: 'prop', id })
    },
    onPointerOver: (e) => {
      if (targeting) return
      e.stopPropagation()
      onHover(resolve(e) ?? null)
    },
    onPointerOut: () => onHover(null),
  }
}
