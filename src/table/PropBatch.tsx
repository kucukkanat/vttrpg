/**
 * Instanced props: every prop of one model drawn as one InstancedMesh per sub-mesh (geometry and
 * material pair) of that model, so 2,000 props of 20 kinds cost a few dozen draw calls instead of
 * thousands.
 *
 * - Instance matrices are rewritten only for props whose document object changed (the store keeps
 *   identity for untouched props; see InstanceSlots in propInstances.ts).
 * - Each batch is frustum culled as a whole, by a bounding sphere over its instances, recomputed
 *   after every change.
 * - Picking: R3F reports the hit `instanceId`; the slot table maps it back to the prop id, and the
 *   pointer handlers are the ones PropMesh uses (propPointer.ts).
 * - Hover draws the same floor outline as PropMesh. Selected, edited and dragged props never reach
 *   a batch (Props.tsx), so the gizmo and the selection outline work on a real object.
 * - Solid props publish their footprint to `propWalls`, like PropMesh.
 * - Models a batch cannot draw faithfully (lights inside, skinning, glow sprites on this graphics
 *   tier), version 1 props and missing files fall back to standalone PropMesh.
 * - Three's scene fog applies through the materials as before; the fog-of-war overlay is drawn over
 *   the board and needs nothing per prop.
 */
import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useCursor } from '@react-three/drei'
import {
  BoxGeometry, DynamicDrawUsage, EdgesGeometry, Group, InstancedMesh, Light, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry,
  SkinnedMesh, Vector3, type BufferGeometry, type Material, type Object3D, type Box3,
} from 'three'
import type { Prop } from '@/core/doc'
import type { PropId } from '@/core/ids'
import { propScale } from '@/core/props'
import { HOVER } from '@/ui/theme/palette'
import { useTable } from './context'
import { footprintWalls } from './editing'
import type { WallSegment } from './walls'
import { useTableUi } from './tableState'
import { buildGlow, materialModeFor } from './stylize'
import { ModelBoundary, prepareModel, useAssetLoad } from './TokenMesh'
import { useModel } from './useModel'
import { localBounds, MemoPropMesh } from './PropMesh'
import { usePropPointer } from './propPointer'
import { capacityFor, hullBox, instanceBounds, InstanceSlots, partsBounds, propMatrix, sameItems, xzHull, type ModelHull, type XZ } from './propInstances'
import { registerPropBatch } from './build/editRuntime'

const noRaycast = () => undefined
const HELPER = /^(COL|FOG)_/

export interface InstancePart {
  geometry: BufferGeometry
  material: Material | Material[]
  /** The sub-mesh's transform relative to the model root. */
  matrix: Matrix4
}

export interface InstanceModel {
  parts: InstancePart[]
  /** Footprint outline for solid props; null draws no walls (the loading crate). */
  hull: ModelHull | null
  /** Model-space bounds for the hover outline; null draws none. */
  local: Box3 | null
}

/**
 * Splits a prepared model into instanceable parts, or null when instancing would change how it
 * looks or behaves: real lights (lit props), skinned meshes, glow sprites.
 */
export function instanceModel(root: Object3D, glow: boolean): InstanceModel | null {
  let unsupported = false
  root.traverse((o) => { if (o instanceof Light || o instanceof SkinnedMesh) unsupported = true })
  if (unsupported) return null
  if (glow) {
    const g = buildGlow(root)
    if (g) { g.dispose(); return null }
  }
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const parts: InstancePart[] = []
  const points: XZ[] = []
  let minY = Infinity
  let maxY = -Infinity
  const v = new Vector3()
  root.traverseVisible((o) => {
    if (!(o instanceof Mesh) || HELPER.test(o.name) || o.userData.outline) return
    const matrix = inv.clone().multiply(o.matrixWorld)
    parts.push({ geometry: o.geometry, material: o.material, matrix })
    const pos = o.geometry.attributes.position
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix)
      points.push({ x: v.x, z: v.z })
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
    }
  })
  if (!parts.length) return null
  const bounds = localBounds(root)
  return { parts, hull: points.length ? { hull: xzHull(points), minY, maxY } : null, local: bounds.isEmpty() ? null : bounds }
}

/** One batch: all props of a model in the current scene that are not drawn standalone. */
export const PropBatch = memo(function PropBatch({ props }: { props: Prop[] }) {
  const { grid } = useTable()
  // Every prop in a batch shares the hash; keep the first ref so the resolver runs once.
  const [model] = useState(() => props[0]!.model)
  const { url, missing } = useAssetLoad(model)
  const cell = grid.cellSize
  if (missing) return <>{props.map((p) => <MemoPropMesh key={p.id} prop={p} />)}</>
  if (!url) return <CrateBatch props={props} cell={cell} tone="loading" />
  return (
    <ModelBoundary fallback={<CrateBatch props={props} cell={cell} tone="error" />}>
      <Suspense fallback={<CrateBatch props={props} cell={cell} tone="loading" />}>
        <ModelBatch url={url} sha256={model.sha256} name={model.name} props={props} />
      </Suspense>
    </ModelBoundary>
  )
}, (a, b) => sameItems(a.props, b.props))

function ModelBatch({ url, sha256, name, props }: { url: string; sha256: string; name: string | undefined; props: Prop[] }) {
  const gltf = useModel(url, sha256, name)
  const { graphics } = useTable()
  const mode = materialModeFor(gltf.scene, graphics.pbr)
  const prepared = useMemo(() => prepareModel(gltf.scene, mode, false), [gltf, mode])
  const model = useMemo(() => instanceModel(prepared, graphics.glow), [prepared, graphics.glow])
  if (!model) return <>{props.map((p) => <MemoPropMesh key={p.id} prop={p} />)}</>
  return <InstancedProps model={model} props={props} />
}

const crateMaterials = {
  loading: new MeshStandardMaterial({ color: '#6b5b45', roughness: 0.9, wireframe: true }),
  error: new MeshStandardMaterial({ color: '#8a3b3b', roughness: 0.9 }),
}
const unitBox = new BoxGeometry(1, 1, 1)

/** PropMesh's placeholder crates, instanced. */
function CrateBatch({ props, cell, tone }: { props: Prop[]; cell: number; tone: 'loading' | 'error' }) {
  const model = useMemo<InstanceModel>(() => {
    const s = 0.6 * cell
    return { parts: [{ geometry: unitBox, material: crateMaterials[tone], matrix: new Matrix4().makeScale(s, s, s).setPosition(0, s / 2, 0) }], hull: null, local: null }
  }, [cell, tone])
  return <InstancedProps model={model} props={props} />
}

const tmpProp = new Matrix4()
const tmpInstance = new Matrix4()

function InstancedProps({ model, props }: { model: InstanceModel; props: Prop[] }) {
  const { viewer } = useTable()
  const uiSet = useTableUi((s) => s.set)
  const gm = !viewer || viewer.isGm

  // Capacity grows in powers of two; a bigger one means new meshes and a full rewrite.
  const [capacity, setCapacity] = useState(() => capacityFor(props.length))
  if (props.length > capacity) setCapacity(capacityFor(props.length))
  const meshes = useMemo(() => model.parts.map((p) => {
    const m = new InstancedMesh(p.geometry, p.material, capacity)
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    m.count = 0
    m.castShadow = true
    m.receiveShadow = true
    return m
  }), [model, capacity])
  useEffect(() => () => { for (const m of meshes) m.dispose() }, [meshes])
  const slots = useMemo(() => { void meshes; return new InstanceSlots<Prop>() }, [meshes])

  useLayoutEffect(() => {
    const { dirty } = slots.sync(props)
    for (const m of meshes) m.count = slots.count
    if (!dirty.length) return
    for (const slot of dirty) {
      propMatrix(slots.itemAt(slot)!, tmpProp)
      model.parts.forEach((part, i) => meshes[i]!.setMatrixAt(slot, tmpInstance.multiplyMatrices(tmpProp, part.matrix)))
    }
    const first = dirty[0]!
    const last = dirty[dirty.length - 1]!
    for (const m of meshes) {
      m.instanceMatrix.clearUpdateRanges()
      m.instanceMatrix.addUpdateRange(first * 16, (last - first + 1) * 16)
      m.instanceMatrix.needsUpdate = true
      // Recomputed from the live instances on the next frustum test or raycast.
      m.boundingSphere = null
      m.boundingBox = null
    }
  }, [props, slots, meshes, model])

  // Footprints of solid props, republished only for props that changed.
  const walls = useRef(new Map<PropId, Prop>())
  useEffect(() => {
    const hull = model.hull
    const seen = new Set<PropId>()
    const set = {} as Record<PropId, WallSegment[]>
    const drop: PropId[] = []
    for (const p of props) {
      seen.add(p.id)
      const had = walls.current.get(p.id)
      if (had === p) continue
      const box = p.solid && hull ? hullBox(hull, propMatrix(p, tmpProp)) : null
      const segs = box ? footprintWalls(box) : []
      if (segs.length) { set[p.id] = segs; walls.current.set(p.id, p) } else if (had) { drop.push(p.id); walls.current.delete(p.id) }
    }
    for (const id of walls.current.keys()) if (!seen.has(id)) { drop.push(id); walls.current.delete(id) }
    if (!drop.length && !Object.keys(set).length) return
    const next = { ...useTableUi.getState().propWalls, ...set }
    for (const id of drop) delete next[id]
    uiSet({ propWalls: next })
  }, [props, model, uiSet])
  useEffect(() => () => {
    const ids = [...walls.current.keys()]
    walls.current.clear()
    const cur = useTableUi.getState().propWalls
    if (!ids.some((id) => cur[id])) return
    const next = { ...cur }
    for (const id of ids) delete next[id]
    uiSet({ propWalls: next })
  }, [uiSet])

  // Box select, drop to surface and the place tool find instances through the registry.
  const group = useRef<Group>(null)
  const local = useMemo(() => partsBounds(model.parts), [model])
  useEffect(() => {
    const object = group.current
    if (!object) return
    return registerPropBatch({
      object,
      has: (id) => slots.slotOf(id) !== undefined,
      boundsOf: (id, out) => {
        const slot = slots.slotOf(id)
        const item = slot === undefined ? undefined : slots.itemAt(slot)
        return item && !local.isEmpty() ? instanceBounds(local, item, out) : null
      },
    })
  }, [slots, local])

  const [hovered, setHovered] = useState<PropId | null>(null)
  const handlers = usePropPointer((e) => slots.idAt(e.instanceId) as PropId | undefined, setHovered)
  const hoveredProp = hovered ? props.find((p) => p.id === hovered) : undefined
  useCursor(!!hoveredProp && gm && !hoveredProp.locked, 'grab')

  return (
    <group ref={group} userData={{ propSlots: slots }} {...handlers}>
      {meshes.map((m) => <primitive key={m.uuid} object={m} />)}
      {hoveredProp && model.local && <HoverOutline prop={hoveredProp} local={model.local} />}
    </group>
  )
}

/** PropMesh's hover outline: a rectangle on the floor around the model's own bounds. */
function HoverOutline({ prop, local }: { prop: Prop; local: Box3 }) {
  const scale = propScale(prop)
  const outline = useMemo(() => {
    const w = Math.max(0.1 / Math.max(scale.x, 1e-6), local.max.x - local.min.x) * 1.04
    const d = Math.max(0.1 / Math.max(scale.z, 1e-6), local.max.z - local.min.z) * 1.04
    return { geometry: new EdgesGeometry(new PlaneGeometry(w, d)), cx: (local.min.x + local.max.x) / 2, cz: (local.min.z + local.max.z) / 2 }
  }, [local, scale.x, scale.z])
  useEffect(() => () => outline.geometry.dispose(), [outline])
  return (
    <group position={[prop.position.x, prop.position.y, prop.position.z]} rotation={[prop.rotation.x, prop.rotation.y, prop.rotation.z]}>
      <group scale={[scale.x, scale.y, scale.z]}>
        <lineSegments geometry={outline.geometry} rotation-x={-Math.PI / 2} position={[outline.cx, 0.012 / Math.max(scale.y, 1e-6), outline.cz]} renderOrder={3} raycast={noRaycast}>
          <lineBasicMaterial color={HOVER} transparent opacity={0.5} depthWrite={false} />
        </lineSegments>
      </group>
    </group>
  )
}
