/**
 * Non-reactive bookkeeping shared by the prop editing pieces (prop meshes, the gizmo, the keys,
 * the touch gestures, the prop menu): the scene objects of standalone props, the loaded scene
 * root (for drop to surface and box select) and the touch gesture handshake.
 */
import type { Object3D } from 'three'
import type { PropId } from '@/core/ids'

/** Root objects of props drawn as standalone meshes, by id (`PropMesh` registers them). */
export const propObjects = new Map<PropId, Object3D>()

export function registerPropObject(id: PropId, object: Object3D | null): () => void {
  if (!object) return () => {}
  propObjects.set(id, object)
  return () => { if (propObjects.get(id) === object) propObjects.delete(id) }
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
