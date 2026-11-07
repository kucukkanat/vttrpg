/**
 * Two-tap move (see twoTapMove.ts). `TwoTapMoveLayer` sits inside the <Canvas>: it turns floor
 * taps into previews and commits, and draws the preview (the tinted path with its distance, and a
 * ghost at the destination). `MoveBar` sits over the table outside the canvas with the distance,
 * Cancel and Move. The table's `onPointerMissed` asks `moveMissed` first; when it takes the tap
 * the floor tap neither deselects nor counts toward a double-tap ping.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { haptic } from '@/ui/feedback/haptics'
import { readPref } from '@/ui/feedback/prefs'
import type { GridSpec } from '@/core/geometry'
import { canControl, useTable, type ViewerInfo } from './context'
import { moveMeasure } from './moveDistance'
import { useTableUi } from './tableState'
import { DragGhostMesh } from './TokenMesh'
import { MoveTrail } from './TokenOverlays'
import { draftAt, isTouchTap, moveIntents, setMoveDraft, stepMoveTap, useMoveDraft, type MoveDraft } from './twoTapMove'

type MissHandler = (e: MouseEvent) => boolean
let missHandler: MissHandler | null = null

/** Called from the table's `onPointerMissed`; true when the tap was a two-tap move step. */
export function moveMissed(e: MouseEvent): boolean {
  return missHandler?.(e) ?? false
}

const coarse = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/** Send the draft's moves and drop it. */
function commit(draft: MoveDraft, onIntent: (i: Intent) => void, mayMove: (id: TokenId) => boolean, grid: GridSpec, floorY: number) {
  const s = useGame.getState()
  const intents = moveIntents(draft, s.tokens, s.selectedTokens, mayMove, grid, floorY)
  setMoveDraft(null)
  for (const i of intents) onIntent(i)
  if (intents.length) haptic('commit')
}

export function TwoTapMoveLayer() {
  const { grid, floorY, sceneId, viewer, onIntent } = useTable()
  const draft = useMoveDraft((s) => s.draft)
  const token = useGame((s) => (draft ? s.tokens[draft.token] : undefined))
  const selected = useGame((s) => s.selectedToken)
  const color = useGame((s) => (viewer ? s.presence[viewer.pubkey]?.color : undefined)) ?? '#ffd166'
  const pack = useGame((s) => s.meta?.pack ?? null)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scratch = useMemo(() => ({ plane: new Plane(new Vector3(0, 1, 0), -floorY), hit: new Vector3(), ray: new Raycaster(), ndc: new Vector2() }), [floorY])
  const mayMove = useCallback((id: TokenId) => { const t = useGame.getState().tokens[id]; return !!t && canControl(viewer, t) }, [viewer])

  const floorAt = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    scratch.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    scratch.ray.setFromCamera(scratch.ndc, camera)
    scratch.plane.set(scratch.plane.normal, -floorY)
    if (!scratch.ray.ray.intersectPlane(scratch.plane, scratch.hit)) return null
    return { x: scratch.hit.x, z: scratch.hit.z }
  }, [gl, camera, floorY, scratch])

  useEffect(() => {
    missHandler = (e) => {
      if (e.type !== 'click' || e.button !== 0) return false
      if (!isTouchTap(e as PointerEvent, coarse()) || !readPref('twoTapMove')) return false
      const ui = useTableUi.getState()
      if (ui.tool || ui.targeting || ui.editMode || ui.editDrag || ui.drag || ui.multiSelect) return false
      const s = useGame.getState()
      const t = s.selectedToken ? s.tokens[s.selectedToken] : undefined
      if (!t || t.scene !== sceneId || !canControl(viewer, t)) return false
      const p = floorAt(e.clientX, e.clientY)
      if (!p) return false
      const r = stepMoveTap(useMoveDraft.getState().draft, draftAt(grid, t.id, t.position, p.x, p.z))
      if (r.kind === 'commit') commit(r.draft, onIntent, mayMove, grid, floorY)
      else if (r.kind === 'cancel') setMoveDraft(null)
      else { setMoveDraft(r.draft); haptic('press') }
      return true
    }
    return () => { missHandler = null }
  }, [grid, floorY, sceneId, viewer, onIntent, floorAt, mayMove])

  // The preview belongs to the selected token where it stands: anything else ends it.
  useEffect(() => {
    if (!draft) return
    if (!token || selected !== draft.token || token.scene !== sceneId || token.position.x !== draft.from.x || token.position.z !== draft.from.z) setMoveDraft(null)
  }, [draft, token, selected, sceneId])
  useEffect(() => useTableUi.subscribe((ui) => {
    if ((ui.targeting || ui.tool || ui.editMode || ui.drag) && useMoveDraft.getState().draft) setMoveDraft(null)
  }), [])
  useEffect(() => {
    if (!draft) return
    // Esc drops the preview only (the table's own Esc, which deselects, runs in the bubble phase).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setMoveDraft(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [draft])
  useEffect(() => () => setMoveDraft(null), [])

  if (!draft || !token) return null
  return (
    <>
      <MoveTrail grid={grid} from={draft.from} to={draft} y={floorY + 0.014} pack={pack} />
      <DragGhostMesh token={token} x={draft.x} z={draft.z} color={color} />
    </>
  )
}

/** Distance, Cancel and Move for the previewed move; null without one. */
export function MoveBar({ onIntent, grid, floorY, viewer }: { onIntent(intent: Intent): void; grid: GridSpec; floorY: number; viewer: ViewerInfo | null }) {
  const draft = useMoveDraft((s) => s.draft)
  const token = useGame((s) => (draft ? s.tokens[draft.token] : undefined))
  const pack = useGame((s) => s.meta?.pack ?? null)
  if (!draft || !token) return null
  const label = moveMeasure(grid, draft.from, draft, pack).label
  const mayMove = (id: TokenId) => { const t = useGame.getState().tokens[id]; return !!t && canControl(viewer, t) }
  return (
    <div className="targeting-bar move-bar" role="group" aria-label="Move preview">
      <div className="targeting-bar__card">
        <div className="targeting-bar__text" aria-live="polite">
          Move {token.name} · {label}
          <span className="move-bar__hint"> · tap the cell again to go</span>
        </div>
        <div className="targeting-bar__actions">
          <button type="button" className="targeting-bar__btn" onClick={() => { setMoveDraft(null); haptic('cancel') }}>Cancel</button>
          <button type="button" className="targeting-bar__btn targeting-bar__btn--primary" onClick={() => commit(draft, onIntent, mayMove, grid, floorY)}>Move</button>
        </div>
      </div>
    </div>
  )
}
