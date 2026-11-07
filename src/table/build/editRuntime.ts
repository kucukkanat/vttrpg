/**
 * Non-reactive bookkeeping shared by the prop editing pieces (prop meshes, the gizmo, the keys,
 * the touch gestures, the prop menu): the scene objects of standalone props, the instanced
 * batches, the loaded scene root (for drop to surface and box select) and the touch gesture
 * handshake.
 *
 * Every prop on the board is either a standalone `PropMesh` (in `propObjects`) or one instance of
 * a `PropBatch` (in `propBatches`). `propBounds`, `propRayTargets` and `propIdOfHit` answer for
 * both, so box select, drop to surface and the place tool treat them the same.
 */
import { Box3, Raycaster, type Intersection, type Object3D, type Ray } from 'three'
import type { PropId } from '@/core/ids'

/** Root objects of props drawn as standalone meshes, by id (`PropMesh` registers them). */
export const propObjects = new Map<PropId, Object3D>()

export function registerPropObject(id: PropId, object: Object3D | null): () => void {
  if (!object) return () => {}
  propObjects.set(id, object)
  return () => { if (propObjects.get(id) === object) propObjects.delete(id) }
}

/** One instanced batch (`PropBatch` registers it while mounted). */
export interface PropBatchHandle {
  /** The batch's group: raycasts against it report an `instanceId` its slots map back to a prop. */
  object: Object3D
  /** Whether this batch draws the prop now. */
  has(id: PropId): boolean
  /** World bounds of one instance into `out`; null when the batch does not draw it. */
  boundsOf(id: PropId, out: Box3): Box3 | null
}

export const propBatches = new Set<PropBatchHandle>()

export function registerPropBatch(handle: PropBatchHandle): () => void {
  propBatches.add(handle)
  return () => void propBatches.delete(handle)
}

/**
 * World bounds of a prop as drawn: its standalone mesh, else its instance in a batch. Null when it
 * is not on the board (another scene, or still loading with nothing drawn).
 */
export function propBounds(id: PropId, out: Box3 = new Box3()): Box3 | null {
  const o = propObjects.get(id)
  if (o) {
    o.updateWorldMatrix(true, true)
    out.setFromObject(o, true)
    if (!out.isEmpty()) return out
  }
  for (const b of propBatches) if (b.has(id)) return b.boundsOf(id, out)
  return null
}

/** Objects to raycast for props: every standalone root not in `skip`, and every batch group. */
export function propRayTargets(skip?: ReadonlySet<PropId>): Object3D[] {
  const out: Object3D[] = []
  for (const [id, o] of propObjects) if (!skip?.has(id)) out.push(o)
  for (const b of propBatches) out.push(b.object)
  return out
}

interface PropUserData { propId?: unknown; propSlots?: { idAt(slot: number | undefined): string | undefined } }

/** The prop a ray hit belongs to: a PropMesh group's `propId`, or a PropBatch's instance slot. */
export function propIdOfHit(hit: Pick<Intersection, 'object' | 'instanceId'>): PropId | undefined {
  for (let x: Object3D | null = hit.object; x; x = x.parent) {
    const d = x.userData as PropUserData
    if (typeof d.propId === 'string') return d.propId as PropId
    if (d.propSlots) return d.propSlots.idAt(hit.instanceId) as PropId | undefined
  }
  return undefined
}

function visibleUp(o: Object3D): boolean {
  for (let x: Object3D | null = o; x; x = x.parent) if (!x.visible) return false
  return true
}

const rayCaster = new Raycaster()

/**
 * Prop hits along a ray, nearest first, standalone and instanced alike; props in `skip` are left
 * out (a batch is one object, so its hits are filtered by the prop they map to).
 */
export function propHits(ray: Ray, skip?: ReadonlySet<PropId>, far = Infinity): Array<{ id: PropId; hit: Intersection }> {
  rayCaster.ray.copy(ray)
  rayCaster.far = far
  rayCaster.layers.enableAll()
  const out: Array<{ id: PropId; hit: Intersection }> = []
  for (const hit of rayCaster.intersectObjects(propRayTargets(skip), true)) {
    if (!(hit.object as { isMesh?: boolean }).isMesh || !visibleUp(hit.object)) continue
    const id = propIdOfHit(hit)
    if (!id || skip?.has(id)) continue
    out.push({ id, hit })
  }
  return out
}

/** The nearest prop under a ray, if any. */
export function propUnderRay(ray: Ray, skip?: ReadonlySet<PropId>): PropId | undefined {
  return propHits(ray, skip)[0]?.id
}

export const editRuntime: {
  /** The loaded scene model's root, for drop-to-surface raycasts. */
  sceneRoot: Object3D | null
  /**
   * A finger went down on a selected prop: a second finger now turns and scales the selection
   * instead of moving the camera. Cleared when that finger lifts.
   */
  touchArm: { pointerId: number; prop: PropId } | null
  /** A two-finger gesture on the selection is running; a one-finger prop drag gives way to it. */
  gestureActive: boolean
  /** When the last gesture ended (performance.now()); a finger lifting after it is not a tap. */
  gestureEndedAt: number
} = {
  sceneRoot: null,
  touchArm: null,
  gestureActive: false,
  gestureEndedAt: 0,
}

/** Coarse pointer (touch first) on a phone-width screen: no box select and no advanced mode. */
export function isPhoneLike(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 699.98px)').matches
}

/** Coarse pointer: gizmo handles get at least 44 px hit areas. */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}
