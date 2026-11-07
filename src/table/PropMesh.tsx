/**
 * Props: standalone GLB models placed in a scene (furniture, trees, crates). Tap selects, the GM
 * drags unlocked props on the floor, and `solid` props publish their footprint so fog and the
 * shoulder camera treat them as walls.
 */
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCursor } from '@react-three/drei'
import { Box3, EdgesGeometry, Group, Mesh, PlaneGeometry, type Object3D } from 'three'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import { isLegacyScale, propScale } from '@/core/props'
import { useGame } from '@/state/store'
import { useTable } from './context'
import { footprintWalls } from './editing'
import { legacyPropFit } from './fitScale'
import { noteLegacyFit, queuePropMigration } from './propMigration'
import { useTableUi } from './tableState'
import { HOVER, SELECT } from '@/ui/theme/palette'
import { GlbMini, ModelBoundary, useAssetLoad } from './TokenMesh'
import { MissingModel } from './MissingAsset'
import { usePropPointer } from './propPointer'

const noRaycast = () => undefined

/** Placeholder while the model loads or when it fails: a crate the size of one cell. */
export function Crate({ cell, tone }: { cell: number; tone: 'loading' | 'error' }) {
  const s = 0.6 * cell
  return (
    <mesh position-y={s / 2} castShadow receiveShadow>
      <boxGeometry args={[s, s, s]} />
      <meshStandardMaterial color={tone === 'error' ? '#8a3b3b' : '#6b5b45'} roughness={0.9} wireframe={tone === 'loading'} />
    </mesh>
  )
}

/** Bounding box of a model in its own frame (children's local transforms applied, the root's not). */
export function localBounds(object: Object3D): Box3 {
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
  const { grid, viewer, onIntent } = useTable()
  const selected = useGame((s) => s.selection?.kind === 'prop' && s.selection.id === prop.id)
  const preview = useTableUi((s) => (s.editPreview && s.editPreview.target.kind === 'prop' && s.editPreview.target.id === prop.id ? s.editPreview : null))
  const uiSet = useTableUi((s) => s.set)
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

  // Taps, the context menu and the floor drag (GM, unlocked): shared with the instanced batches.
  const handlers = usePropPointer(() => prop.id, (id) => setHovered(id !== null))

  return (
    <group
      ref={group}
      position={[position.x, position.y, position.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      {...handlers}
    >
      <group scale={[scale.x, scale.y, scale.z]}>
        {url ? (
          <ModelBoundary fallback={<Crate cell={cell} tone="error" />}>
            <Suspense fallback={<Crate cell={cell} tone="loading" />}>
              <GlbMini url={url} sha256={prop.model.sha256} name={prop.model.name} scale={1} onObject={setObject} />
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
export const MemoPropMesh = memo(PropMesh)
