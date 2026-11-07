/**
 * What can be done to the prop selection, each as one intent (so one undo step): group
 * transforms, turn, remove, duplicate, copy, paste and drop to surface. Used by the power keys,
 * the gizmo, the touch gestures, the inspector and the prop menu. `dispatch` is the table's
 * `onIntent` or the controller's dispatch.
 */
import { Box3, Raycaster, Vector3, type Intersection, type Object3D } from 'three'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { PropId, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { knownLegacyFit } from '../propMigration'
import { tableRuntime, useTableUi } from '../tableState'
import { editRuntime, propBounds, propRayTargets } from './editRuntime'
import { applyGroupOp, poseOf, selectionCentre, updatesFrom, type GroupOp, type Poses } from './groupTransform'
import { pickUpModel } from './buildState'
import type { HeldModel, HeldPart } from './placement'
import { clipFromProps, decodeClip, duplicateOffset, duplicateProps, encodeClip, propsFromClip, type PropClip } from './propClipboard'

type Dispatch = (intent: Intent) => void

const fit = (id: PropId) => knownLegacyFit(id) ?? 1

/** The scene on screen: the GM's preview, else the live scene. */
export function shownScene(): SceneId | null {
  return useTableUi.getState().previewScene ?? useGame.getState().meta?.activeScene ?? null
}

/** The selected props that still exist, in selection order. */
export function selectedProps(): Prop[] {
  const s = useGame.getState()
  return s.propSelection.map((id) => s.props[id]).filter((p): p is Prop => !!p)
}

export function posesOf(props: readonly Prop[]): Poses {
  const out: Poses = {}
  for (const p of props) out[p.id] = poseOf(p, fit(p.id))
  return out
}

export function selectionPoses(): Poses {
  return posesOf(selectedProps())
}

export function centreOf(poses: Poses): Vec3 {
  return selectionCentre(Object.values(poses))
}

/** Apply `op` to the selection as one `props.update`. False when nothing changed. */
export function commitGroupOp(op: GroupOp, dispatch: Dispatch, poses: Poses = selectionPoses()): boolean {
  const updates = updatesFrom(poses, applyGroupOp(poses, op))
  if (!updates.length) return false
  dispatch({ type: 'props.update', updates })
  return true
}

/** Turn the selection `degrees` around Y about its centre. */
export function turnSelection(degrees: number, dispatch: Dispatch): boolean {
  const poses = selectionPoses()
  if (!Object.keys(poses).length) return false
  return commitGroupOp({ kind: 'rotate', axis: { x: 0, y: 1, z: 0 }, angle: (degrees * Math.PI) / 180, centre: centreOf(poses) }, dispatch, poses)
}

/** Remove every selected prop in one intent and clear the selection. */
export function removeSelection(dispatch: Dispatch): boolean {
  const ids = selectedProps().map((p) => p.id)
  if (!ids.length) return false
  dispatch({ type: 'props.remove', ids })
  useGame.getState().clearPropSelection()
  return true
}

function cellSize(scene: SceneId | null): number {
  return (scene && useGame.getState().scenes[scene]?.grid.cellSize) || 1
}

/** Place `props` in one intent and select them. */
function placeAndSelect(props: Prop[], dispatch: Dispatch): boolean {
  if (!props.length) return false
  dispatch({ type: 'props.place', props })
  useGame.getState().setPropSelection(props.map((p) => p.id))
  return true
}

/** Ctrl/Cmd-D: copies of the selection one cell along x, selected. */
export function duplicateSelection(dispatch: Dispatch, offset?: Vec3): boolean {
  const props = selectedProps()
  if (!props.length) return false
  return placeAndSelect(duplicateProps(props, offset ?? duplicateOffset(cellSize(props[0]!.scene)), fit), dispatch)
}

/** Alt-drag: copies of `props` at `poses` (the dragged-to spots), selected; the originals stay. */
export function placeCopiesAt(props: readonly Prop[], poses: Poses, dispatch: Dispatch): boolean {
  const copies = duplicateProps(props, { x: 0, y: 0, z: 0 }, fit).map((c, i) => {
    const pose = poses[props[i]!.id]
    return pose ? { ...c, position: pose.position, rotation: pose.rotation, scale: pose.scale } : c
  })
  return placeAndSelect(copies, dispatch)
}

let internalClip: PropClip | null = null

/** The internal clipboard (last copy in this tab). */
export function internalClipboard(): PropClip | null {
  return internalClip
}

/** Copy the selection to the internal clipboard; returns the text form for the system clipboard. */
export function copySelection(): string | null {
  const props = selectedProps()
  if (!props.length) return null
  internalClip = clipFromProps(props, cellSize(props[0]!.scene), fit)
  return encodeClip(internalClip)
}

/** Where a paste lands: the pointer's floor point, else the camera target, else the scene centre. */
export function pastePoint(): Vec3 {
  const p = tableRuntime.cursorFloor ?? tableRuntime.cameraTarget ?? tableRuntime.sceneCenter ?? { x: 0, y: tableRuntime.floorY, z: 0 }
  return { x: p.x, y: tableRuntime.floorY, z: p.z }
}

/** A clip as the held model of the stamp ghost: one model keeps its own turn, a group its layout. */
export function heldFromClip(clip: PropClip): { held: HeldModel; yaw: number } | null {
  const items = clip.items
  if (!items.length) return null
  if (items.length === 1) {
    const it = items[0]!
    return {
      held: { ...(it.catalogue ? { catalogue: it.catalogue } : {}), title: it.name, model: it.model, tilt: { x: it.rotation.x, z: it.rotation.z }, scale: { ...it.scale }, ...(it.fixtures ? { fixtures: it.fixtures } : {}) },
      yaw: it.rotation.y,
    }
  }
  const parts: HeldPart[] = items.map((it) => ({
    title: it.name, model: it.model, offset: { ...it.position }, rotation: { ...it.rotation }, scale: { ...it.scale },
    ...(it.catalogue ? { catalogue: it.catalogue } : {}), ...(it.tags ? { tags: [...it.tags] } : {}),
    ...(it.solid ? { solid: true } : {}), ...(it.locked ? { locked: true } : {}),
    ...(it.fixtures ? { fixtures: it.fixtures } : {}),
  }))
  return { held: { title: `${items.length} pasted props`, model: items[0]!.model, scale: { x: 1, y: 1, z: 1 }, parts }, yaw: 0 }
}

/**
 * Paste into the hand: the clip (`text` when it is prop clipboard text, else the internal
 * clipboard) becomes the stamp ghost, so it follows the cursor, turns with R and stamps with each
 * click (one `props.place` per click) until Esc.
 */
export function pasteToHand(text?: string | null): boolean {
  const clip = decodeClip(text) ?? internalClip
  if (!clip || !shownScene()) return false
  if (text && decodeClip(text)) internalClip = clip
  const h = heldFromClip(clip)
  if (!h) return false
  pickUpModel(h.held, h.yaw)
  return true
}

/**
 * Paste: `text` when it is prop clipboard text (from another scene or game), else the internal
 * clipboard. The group's centre lands on `at` (default: under the pointer). One `props.place`.
 */
export function paste(dispatch: Dispatch, text?: string | null, at: Vec3 = pastePoint()): boolean {
  const clip = decodeClip(text) ?? internalClip
  const scene = shownScene()
  if (!clip || !scene) return false
  if (text && decodeClip(text)) internalClip = clip
  return placeAndSelect(propsFromClip(clip, scene, at), dispatch)
}

// ------------------------------------------------------------- drop to surface

const down = new Vector3(0, -1, 0)

function visibleChain(o: Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (!n.visible) return false
  return true
}

/** World bounds of a prop as drawn (standalone or instanced), else a point at its position. */
export function propWorldBounds(prop: Prop): Box3 {
  const box = propBounds(prop.id)
  if (box) return box
  const p = new Vector3(prop.position.x, prop.position.y, prop.position.z)
  return new Box3(p.clone(), p.clone())
}

/**
 * The height a body whose bottom is at `bottom` comes to rest on: the highest hit at or below
 * it, else the floor. Never below the floor.
 */
export function restingHeight(bottom: number, hits: readonly number[], floorY: number): number {
  const below = hits.filter((y) => y <= bottom + 1e-6)
  return Math.max(floorY, below.length ? Math.max(...below) : floorY)
}

/**
 * End: lower (or raise, when sunk into the floor) each selected prop so its bottom rests on what
 * is under its centre: other props, the scene model, else the floor. One `props.update`.
 */
export function dropSelection(dispatch: Dispatch, floorY: number = tableRuntime.floorY): boolean {
  const props = selectedProps()
  if (!props.length) return false
  const selected = new Set(props.map((p) => p.id))
  // The scene model, standalone props and instanced batches (a batch never holds a selected prop:
  // selected props draw standalone, see Props.tsx).
  const targets: Object3D[] = propRayTargets(selected)
  if (editRuntime.sceneRoot) targets.push(editRuntime.sceneRoot)
  const ray = new Raycaster()
  const updates: { id: PropId; patch: { position: Vec3 } }[] = []
  for (const p of props) {
    const box = propWorldBounds(p)
    const c = box.getCenter(new Vector3())
    const bottom = box.min.y
    ray.set(new Vector3(c.x, bottom + 1e-3, c.z), down)
    const hits = ray.intersectObjects(targets, true)
      .filter((h: Intersection) => (h.object as { isMesh?: boolean }).isMesh && visibleChain(h.object))
      .map((h) => h.point.y)
    const rest = restingHeight(bottom, hits, floorY)
    const dy = rest - bottom
    if (Math.abs(dy) < 1e-4) continue
    updates.push({ id: p.id, patch: { position: { ...p.position, y: Number((p.position.y + dy).toFixed(6)) } } })
  }
  if (!updates.length) return false
  dispatch({ type: 'props.update', updates })
  return true
}
