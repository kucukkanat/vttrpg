/**
 * Transform gizmo for the selected object while edit mode is on (GM, or a player on their own
 * token): move arrows, scale spheres and a turn ring together, screen-sized (`fixed`), about
 * 110 px per axis with 8 px lines so a finger can hold them.
 *
 * The gizmo is "controlled": its matrix is derived from the document, the drag is previewed
 * through `tableState.editPreview` (renderers show the preview instead of the stored transform)
 * and the matching intent is emitted on release. Snapping (half cells / 15° / 0.05) applies unless
 * Alt is held or `snap` is off.
 */
import { useEffect, useMemo, useRef } from 'react'
import { PivotControls } from '@react-three/drei'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Intent } from '@/core/intents'
import type { Vec3 } from '@/core/geometry'
import type { GridSpec } from '@/core/geometry'
import { useGame, type Selection } from '@/state/store'
import { useTable } from './context'
import {
  clamp, effectiveNodeTransform, IDENTITY_TRANSFORM, mergeOverride, SCALE_LIMITS, snapAngle, snapScale, snapTranslation,
  TOKEN_SIZE_LIMITS,
} from './editing'
import { baseOf } from './SceneModel'
import { useTableUi, type EditPreview } from './tableState'

export const GIZMO_PX = 110
export const GIZMO_LINE_PX = 8
/** Exponent on the scale handle's factor: doubling takes about 140 px of travel instead of 550. */
const SCALE_GAIN = 4

interface Target {
  selection: Selection
  /** Gizmo pose in world space: position and Y rotation, unit scale. */
  world: Matrix4
  /** Frame the committed values live in (identity except for scene nodes). */
  parentWorld: Matrix4
  parentInv: Matrix4
  /** Current scale value in document terms. */
  scale: number
  /** Lowest allowed world y of the pivot (tokens cannot go under the floor). */
  minY?: number
  scaleLimits: { min: number; max: number }
  /** Document position from a new local pivot position. */
  toPreview(local: Vec3, rotationY: number, scale: number): EditPreview
  commit(p: EditPreview): Intent | null
}

const UP = new Vector3(0, 1, 0)
const ONE = new Vector3(1, 1, 1)
const yRot = (y: number) => new Quaternion().setFromAxisAngle(UP, y)
const pose = (p: Vec3, y: number) => new Matrix4().compose(new Vector3(p.x, p.y, p.z), yRot(y), ONE)

export function EditGizmo() {
  const { sceneId, scene, grid, floorY, loaded, viewer } = useTable()
  const selection = useGame((s) => s.selection)
  const token = useGame((s) => (s.selection?.kind === 'token' ? s.tokens[s.selection.id] : undefined))
  const prop = useGame((s) => (s.selection?.kind === 'prop' ? s.props[s.selection.id] : undefined))
  const editMode = useTableUi((s) => s.editMode)
  const gm = !viewer || viewer.isGm
  const override = selection?.kind === 'node' ? scene.overrides?.[selection.id] : undefined
  const transform = scene.transform

  const target = useMemo<Target | null>(() => {
    if (!selection) return null
    const identity = new Matrix4()
    switch (selection.kind) {
      case 'token': {
        if (!token || token.scene !== sceneId) return null
        const elev = Math.max(0, token.elevation ?? 0)
        return {
          selection, scale: token.scale, parentWorld: identity, parentInv: identity, minY: floorY, scaleLimits: TOKEN_SIZE_LIMITS,
          world: pose({ x: token.position.x, y: floorY + elev, z: token.position.z }, token.rotationY),
          toPreview: (l, rotationY, scale) => ({
            target: selection, position: { x: l.x, y: token.position.y, z: l.z }, rotationY, scale, elevation: Math.max(0, l.y - floorY),
          }),
          commit: (p) => ({ type: 'token.update', token: token.id, patch: { position: p.position, rotationY: p.rotationY, scale: p.scale, elevation: p.elevation ?? 0 } }),
        }
      }
      case 'prop': {
        if (!prop || prop.scene !== sceneId) return null
        return {
          selection, scale: prop.scale, parentWorld: identity, parentInv: identity, scaleLimits: SCALE_LIMITS, minY: floorY,
          world: pose(prop.position, prop.rotation.y),
          toPreview: (l, rotationY, scale) => ({ target: selection, position: l, rotationY, scale }),
          commit: (p) => ({ type: 'prop.update', prop: prop.id, patch: { position: p.position, rotation: { ...prop.rotation, y: p.rotationY }, scale: p.scale } }),
        }
      }
      case 'node': {
        const o = loaded?.root.getObjectByName(selection.id)
        const base = o ? baseOf(o) : null
        if (!o || !base || !o.parent) return null
        o.parent.updateWorldMatrix(true, false)
        const parentWorld = o.parent.matrixWorld.clone()
        const t = effectiveNodeTransform(base, override)
        return {
          selection, scale: t.scale, parentWorld, parentInv: parentWorld.clone().invert(), scaleLimits: SCALE_LIMITS,
          world: pose(t.position, t.rotationY).premultiply(parentWorld),
          toPreview: (l, rotationY, scale) => ({ target: selection, position: l, rotationY, scale }),
          commit: (p) => ({
            type: 'scene.update', scene: sceneId,
            patch: { overrides: mergeOverride(scene.overrides, selection.id, { position: p.position, rotationY: p.rotationY, scale: p.scale }) },
          }),
        }
      }
      case 'scene': {
        if (selection.id !== sceneId) return null
        const tr = transform ?? IDENTITY_TRANSFORM
        return {
          selection, scale: tr.scale, parentWorld: identity, parentInv: identity, scaleLimits: SCALE_LIMITS,
          world: pose(tr.offset, tr.rotationY),
          toPreview: (l, rotationY, scale) => ({ target: selection, position: l, rotationY, scale }),
          commit: (p) => ({ type: 'scene.update', scene: sceneId, patch: { transform: { scale: p.scale, rotationY: p.rotationY, offset: p.position } } }),
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, token, prop, override, transform, sceneId, loaded, floorY, scene.overrides])

  // The GM edits anything; a player only their own tokens.
  const allowed = gm || (selection?.kind === 'token' && !!token && !!viewer && token.owner === viewer.pubkey)
  if (!editMode || !allowed || !target) return null
  const key = `${target.selection.kind}:${target.selection.id}`
  return <Gizmo key={key} target={target} grid={grid} />
}

/** Tracks whether Alt is held (free movement, no snapping) without re-rendering. */
function useAltKey() {
  const alt = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') alt.current = true }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') alt.current = false }
    const blur = () => { alt.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  return alt
}

function Gizmo({ target, grid }: { target: Target; grid: GridSpec }) {
  const { onIntent } = useTable()
  const snap = useTableUi((s) => s.snap)
  const uiSet = useTableUi((s) => s.set)
  const alt = useAltKey()
  // The matrix PivotControls shows; mutated in place so the gizmo follows the snapped preview.
  const matrix = useMemo(() => target.world.clone(), [target])
  const start = useRef<{ scale: number; axis: 0 | 1 | 2 } | null>(null)
  const tmp = useMemo(() => ({ p: new Vector3(), q: new Quaternion(), s: new Vector3(), lp: new Vector3(), lq: new Quaternion(), ls: new Vector3(), m: new Matrix4(), e: new Euler() }), [])

  // Make sure a drag that ends abruptly (unmount, selection change) leaves no preview behind.
  useEffect(() => () => {
    const ui = useTableUi.getState()
    if (ui.editPreview || ui.editDrag) ui.set({ editPreview: null, editDrag: false })
  }, [])

  const onDragStart = (p: { axis: 0 | 1 | 2 }) => {
    start.current = { scale: target.scale, axis: p.axis }
    uiSet({ editDrag: true })
  }

  const onDrag = (l: Matrix4) => {
    const { p, q, s, lp, lq, ls, m, e } = tmp
    // `l` is the gizmo's matrix in its parent frame; the gizmo sits at the canvas root, so world.
    l.decompose(p, q, s)
    const free = alt.current || !snap
    const wp = free ? { x: p.x, y: p.y, z: p.z } : snapTranslation(p, grid)
    if (target.minY !== undefined && wp.y < target.minY) wp.y = target.minY
    // document frame
    m.compose(p.set(wp.x, wp.y, wp.z), q, ONE).premultiply(target.parentInv).decompose(lp, lq, ls)
    let rotationY = e.setFromQuaternion(lq, 'YXZ').y
    if (!free) rotationY = snapAngle(rotationY)
    const axis = start.current?.axis ?? 1
    // The scaling sphere doubles only after ~5 gizmo lengths of travel; a finger needs it quicker.
    const factor = Math.pow(axis === 0 ? s.x : axis === 2 ? s.z : s.y, SCALE_GAIN)
    let scale = (start.current?.scale ?? target.scale) * factor
    scale = free ? clamp(scale, target.scaleLimits.min, target.scaleLimits.max) : clamp(snapScale(scale), target.scaleLimits.min, target.scaleLimits.max)
    // the gizmo itself follows the snapped values
    matrix.compose(lp, yRot(rotationY), ONE).premultiply(target.parentWorld)
    const preview = target.toPreview({ x: lp.x, y: lp.y, z: lp.z }, rotationY, scale)
    const cur = useTableUi.getState().editPreview
    if (cur && samePreview(cur, preview)) return
    uiSet({ editPreview: preview })
  }

  const onDragEnd = () => {
    const preview = useTableUi.getState().editPreview
    start.current = null
    uiSet({ editPreview: null, editDrag: false })
    if (!preview || preview.target.kind !== target.selection.kind || preview.target.id !== target.selection.id) return
    const intent = target.commit(preview)
    if (intent) onIntent(intent)
  }

  // One gizmo with every handle: arrows move, the spheres at their tips scale, the ring turns
  // around Y. Two PivotControls share the same matrix object, so dragging either moves both.
  const common = {
    matrix, autoTransform: false, fixed: true, scale: GIZMO_PX, lineWidth: GIZMO_LINE_PX, depthTest: false, disableSliders: true,
    axisColors: ['#ff5a7a', '#8fd18f', '#5aa9ff'] as [string, string, string], hoveredColor: '#ffd166',
    onDragStart, onDrag, onDragEnd,
  }
  return (
    <>
      <PivotControls {...common} disableRotations activeAxes={[true, true, true]} />
      <PivotControls {...common} disableAxes disableScaling activeAxes={[true, false, true]} />
    </>
  )
}

function samePreview(a: EditPreview, b: EditPreview): boolean {
  return a.position.x === b.position.x && a.position.y === b.position.y && a.position.z === b.position.z
    && a.rotationY === b.rotationY && a.scale === b.scale && a.elevation === b.elevation
}
