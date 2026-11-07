/**
 * Props: standalone GLB models placed in a scene (furniture, trees, crates). Tap selects, the GM
 * drags unlocked props on the floor, and `solid` props publish their footprint so fog and the
 * shoulder camera treat them as walls.
 */
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import { Box3, EdgesGeometry, Group, Mesh, Plane, PlaneGeometry, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import { isLegacyScale, propScale, uniformScale } from '@/core/props'
import type { SceneId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from './context'
import { footprintWalls, snapTranslation } from './editing'
import { legacyPropFit } from './fitScale'
import { noteLegacyFit, queuePropMigration } from './propMigration'
import { useTableUi } from './tableState'
import { HOVER, SELECT } from '@/ui/theme/palette'
import { doubleTapEdit, tapTwice } from './editTap'
import { capture, DRAG_THRESHOLD_PX, GlbMini, LONG_PRESS_MS, ModelBoundary, useAssetLoad } from './TokenMesh'
import { MissingModel } from './MissingAsset'

const noRaycast = () => undefined

export function Props({ sceneId }: { sceneId: SceneId }) {
  const props = useGame((s) => s.props)
  const list = useMemo(() => Object.values(props).filter((p) => p.scene === sceneId), [props, sceneId])
  return <>{list.map((p) => <MemoPropMesh key={p.id} prop={p} />)}</>
}

/** Placeholder while the model loads or when it fails: a crate the size of one cell. */
function Crate({ cell, tone }: { cell: number; tone: 'loading' | 'error' }) {
  const s = 0.6 * cell
  return (
    <mesh position-y={s / 2} castShadow receiveShadow>
      <boxGeometry args={[s, s, s]} />
      <meshStandardMaterial color={tone === 'error' ? '#8a3b3b' : '#6b5b45'} roughness={0.9} wireframe={tone === 'loading'} />
    </mesh>
  )
}

/** Bounding box of a model in its own frame (children's local transforms applied, the root's not). */
function localBounds(object: Group): Box3 {
  object.updateWorldMatrix(true, true)
  const inv = object.matrixWorld.clone().invert()
  const out = new Box3()
  const tmp = new Box3()
  object.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return
    const g = o.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    if (!g.boundingBox) return
    tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
    out.union(tmp)
  })
  return out
}

export function PropMesh({ prop }: { prop: Prop }) {
  const { grid, floorY, viewer, onIntent } = useTable()
  const selected = useGame((s) => s.selection?.kind === 'prop' && s.selection.id === prop.id)
  const setSelection = useGame((s) => s.setSelection)
  const preview = useTableUi((s) => (s.editPreview && s.editPreview.target.kind === 'prop' && s.editPreview.target.id === prop.id ? s.editPreview : null))
  const targeting = useTableUi((s) => s.targeting !== null)
  const snap = useTableUi((s) => s.snap)
  const uiSet = useTableUi((s) => s.set)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const { url, missing } = useAssetLoad(prop.model)
  const [hovered, setHovered] = useState(false)
  const [object, setObject] = useState<Group | null>(null)
  const group = useRef<Group>(null)

  const gm = !viewer || viewer.isGm
  const draggable = gm && !prop.locked
  useCursor(hovered && draggable, 'grab')

  const position = preview?.position ?? prop.position
  const rotation = preview ? { x: prop.rotation.x, y: preview.rotationY, z: prop.rotation.z } : prop.rotation
  const cell = grid.cellSize

  // Models draw at their real size times the per-axis scale. A version 1 prop (number scale) is
  // drawn with the one-cell fit it always had until a GM client migrates it (src/core/props.ts).
  const legacy = isLegacyScale(prop.scale)
  const legacyFit = useMemo(() => (object && legacy ? legacyPropFit(object, cell) : 1), [object, legacy, cell])
  useEffect(() => {
    if (!object || !legacy) return
    noteLegacyFit(prop.id, legacyFit)
    if (gm) queuePropMigration(prop.id, legacyFit, onIntent)
  }, [object, legacy, legacyFit, prop.id, gm, onIntent])
  const base = propScale(prop, legacyFit)
  const scale: Vec3 = preview?.scaleVec ?? base

  // Selection outline from the model's own bounds (inside the scaled group); footprint for
  // line-of-sight from the world bounds, republished whenever the model or transform changes.
  const local = useMemo(() => (object ? localBounds(object) : null), [object])
  const outline = useMemo(() => {
    if (!local || local.isEmpty()) return null
    const w = Math.max(0.1 / Math.max(scale.x, 1e-6), local.max.x - local.min.x) * 1.04
    const d = Math.max(0.1 / Math.max(scale.z, 1e-6), local.max.z - local.min.z) * 1.04
    return { geometry: new EdgesGeometry(new PlaneGeometry(w, d)), cx: (local.min.x + local.max.x) / 2, cz: (local.min.z + local.max.z) / 2 }
  }, [local, scale.x, scale.z])
  useEffect(() => () => outline?.geometry.dispose(), [outline])

  const removeWalls = useCallback(() => {
    const walls = useTableUi.getState().propWalls
    if (!walls[prop.id]) return
    const next = { ...walls }
    delete next[prop.id]
    uiSet({ propWalls: next })
  }, [prop.id, uiSet])
  useEffect(() => {
    const g = group.current
    if (!prop.solid || !object || !g) { removeWalls(); return }
    g.updateWorldMatrix(true, true)
    const box = new Box3().setFromObject(object, true)
    if (box.isEmpty()) { removeWalls(); return }
    uiSet({ propWalls: { ...useTableUi.getState().propWalls, [prop.id]: footprintWalls(box) } })
  }, [object, position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, scale.x, scale.y, scale.z, prop.solid, prop.id, uiSet, removeWalls])
  useEffect(() => removeWalls, [removeWalls])

  // Floor drag (GM, unlocked). Mirrors the token drag but previews through `editPreview`.
  const drag = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean; longPress: ReturnType<typeof setTimeout> | null; plane: Plane; offX: number; offZ: number } | null>(null)
  const hit = useMemo(() => new Vector3(), [])
  const toggleSelect = useCallback(() => setSelection(selected ? null : { kind: 'prop', id: prop.id }), [setSelection, selected, prop.id])

  const endDrag = (commit: boolean) => {
    const d = drag.current
    if (!d) return
    if (d.longPress) clearTimeout(d.longPress)
    drag.current = null
    if (controls) controls.enabled = true
    const pv = useTableUi.getState().editPreview
    uiSet({ editDrag: false, editPreview: null })
    if (!d.moved) return
    if (commit && pv && pv.target.kind === 'prop' && pv.target.id === prop.id) {
      const p = pv.position
      if (Math.abs(p.x - prop.position.x) > 1e-4 || Math.abs(p.z - prop.position.z) > 1e-4) {
        onIntent({ type: 'props.update', updates: [{ id: prop.id, patch: { position: { x: p.x, y: prop.position.y, z: p.z } } }] })
      }
    }
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (targeting) return
    e.stopPropagation()
    if (e.button === 2) { setSelection({ kind: 'prop', id: prop.id }); return }
    if (e.button !== 0) return
    if (!draggable) {
      const twice = tapTwice(`prop:${prop.id}`, e.nativeEvent.clientX, e.nativeEvent.clientY)
      if (twice && doubleTapEdit(gm ? { kind: 'prop', id: prop.id } : null)) return
      setSelection({ kind: 'prop', id: prop.id })
      return
    }
    capture(e).setPointerCapture(e.pointerId)
    uiSet({ editDrag: true })
    const plane = new Plane(new Vector3(0, 1, 0), -Math.max(floorY, prop.position.y))
    const off = e.ray.intersectPlane(plane, hit) ? { x: hit.x - prop.position.x, z: hit.z - prop.position.z } : { x: 0, z: 0 }
    drag.current = {
      pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false,
      longPress: e.pointerType === 'touch' ? setTimeout(() => { if (drag.current && !drag.current.moved) { toggleSelect(); endDrag(false) } }, LONG_PRESS_MS) : null,
      plane, offX: off.x, offZ: off.z,
    }
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (!d.moved) {
      if (Math.hypot(e.nativeEvent.clientX - d.startX, e.nativeEvent.clientY - d.startY) < DRAG_THRESHOLD_PX) return
      d.moved = true
      if (d.longPress) { clearTimeout(d.longPress); d.longPress = null }
      if (controls) controls.enabled = false
      if (!selected) setSelection({ kind: 'prop', id: prop.id })
    }
    if (!e.ray.intersectPlane(d.plane, hit)) return
    let p = { x: hit.x - d.offX, y: prop.position.y, z: hit.z - d.offZ }
    if (snap && !e.nativeEvent.altKey) p = { ...snapTranslation(p, grid), y: prop.position.y }
    const cur = useTableUi.getState().editPreview
    if (cur && cur.target.kind === 'prop' && cur.target.id === prop.id && cur.position.x === p.x && cur.position.z === p.z) return
    uiSet({ editPreview: { target: { kind: 'prop', id: prop.id }, position: p, rotationY: prop.rotation.y, scale: uniformScale(base), scaleVec: base } })
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).releasePointerCapture(e.pointerId)
    const wasClick = !d.moved
    endDrag(true)
    if (!wasClick) return
    if (tapTwice(`prop:${prop.id}`, e.nativeEvent.clientX, e.nativeEvent.clientY) && doubleTapEdit({ kind: 'prop', id: prop.id })) return
    // In edit mode a tap keeps the prop selected (the gizmo stays); otherwise it toggles.
    if (useTableUi.getState().editMode) setSelection({ kind: 'prop', id: prop.id })
    else toggleSelect()
  }
  useEffect(() => () => { if (drag.current) endDrag(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group
      ref={group}
      position={[position.x, position.y, position.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endDrag(false)}
      onLostPointerCapture={() => endDrag(false)}
      onContextMenu={(e) => { if (targeting) return; e.stopPropagation(); e.nativeEvent.preventDefault(); setSelection({ kind: 'prop', id: prop.id }) }}
      onPointerOver={(e) => { if (targeting) return; e.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
    >
      <group scale={[scale.x, scale.y, scale.z]}>
        {url ? (
          <ModelBoundary fallback={<Crate cell={cell} tone="error" />}>
            <Suspense fallback={<Crate cell={cell} tone="loading" />}>
              <GlbMini url={url} scale={1} onObject={setObject} />
            </Suspense>
          </ModelBoundary>
        ) : missing ? (
          <MissingModel size={0.6 * cell} />
        ) : (
          <Crate cell={cell} tone="loading" />
        )}
        {(selected || hovered) && outline && (
          <lineSegments geometry={outline.geometry} rotation-x={-Math.PI / 2} position={[outline.cx, 0.012 / Math.max(scale.y, 1e-6), outline.cz]} renderOrder={3} raycast={noRaycast}>
            <lineBasicMaterial color={selected ? SELECT : HOVER} transparent opacity={selected ? 0.95 : 0.5} depthWrite={false} />
          </lineSegments>
        )}
      </group>
      {prop.locked && selected && (
        <mesh position-y={0.02} rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={3}>
          <ringGeometry args={[0.1 * cell, 0.14 * cell, 24]} />
          <meshBasicMaterial color="#ff9a93" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

/** Props whose document object did not change skip re-rendering (the store keeps their identity). */
const MemoPropMesh = memo(PropMesh)
