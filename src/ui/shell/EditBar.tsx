/**
 * Edit bar: shown over the bottom of the table while edit mode is on (double tap on a token or prop,
 * or "Edit" in its menu), and while props are selected with the Edit toggle on (there without
 * Details: the Inspector shows them). Names what is being edited, toggles
 * snapping, cycles the prop gizmo's mode (like Tab), toggles the advanced prop gizmo (like A; with
 * world or local axes), and opens "Details" with the numeric editors (size, model, solid, hide a
 * room part…; in advanced mode the prop inspector with expressions).
 * "Done" (or another double tap) leaves edit mode and lets go of the props.
 */
import { useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import { Selected } from '../panels/ObjectPanel'
import { PropInspector } from '../panels/PropInspector'
import { Icon } from '@/ui/icons'
import { MODE_LABEL, nextMode } from '@/table/build/transformKeys'
import { useBreakpoint } from './useBreakpoint'

export function EditBar({ controller }: { controller: GameController }) {
  const isGm = controller.connection.isGm
  const selection = useGame((s) => s.selection)
  const setSelection = useGame((s) => s.setSelection)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const name = useGame((s) => {
    const sel = s.selection
    if (!sel) return null
    if (sel.kind === 'token') return s.tokens[sel.id]?.name ?? null
    if (sel.kind === 'prop') return s.propSelection.length > 1 ? `${s.propSelection.length} props` : s.props[sel.id]?.name ?? null
    if (sel.kind === 'scene') return s.scenes[sel.id]?.name ?? null
    return sel.id
  })
  const snap = useTableUi((s) => s.snap)
  const set = useTableUi((s) => s.set)
  const [details, setDetails] = useState(false)
  const advanced = useTableUi((s) => s.advanced)
  const space = useTableUi((s) => s.gizmoSpace)
  const gizmoMode = useTableUi((s) => s.gizmoMode)
  const props = useGame((s) => s.propSelection.length > 0)
  // With Edit on the Inspector holds the details; the bar keeps snap, the gizmo mode and Deselect.
  const building = useTableUi((s) => s.buildMode)
  // Phones get no advanced mode.
  const phone = useBreakpoint() === 'phone'
  const done = () => {
    set({ editMode: false, editPreview: null, editDrag: false, transformEntry: null })
    if (useGame.getState().propSelection.length) useGame.getState().clearPropSelection()
  }

  return (
    <div className="edit-dock">
      {details && !building && (
        <div className="dock-card edit-details" role="region" aria-label="Edit details">
          {isGm && props && advanced && !phone && <PropInspector controller={controller} />}
          {selection && scene && sceneId
            ? <Selected key={`${selection.kind}:${selection.id}`} controller={controller} selection={selection} scene={scene} sceneId={sceneId} onDeselect={() => setSelection(null)} />
            : <p className="muted small">Tap a token or prop{isGm ? ', or a part of the room,' : ''} to edit it.</p>}
        </div>
      )}
      <div className="dock-bar edit-bar" role="toolbar" aria-label="Edit mode">
        <span className="edit-bar-title">
          <span className="muted small">Editing</span>
          <strong>{name ?? 'nothing selected'}</strong>
        </span>
        <button type="button" className={`tiny${snap ? ' on' : ''}`} aria-pressed={snap} title="Snap to cells, 15° and 0.05 steps (hold Alt for free movement)" onClick={() => set({ snap: !snap })}>
          Snap
        </button>
        {isGm && props && (
          <button type="button" className="tiny" title="What typed numbers act on and which handle is highlighted (Tab)" onClick={() => set({ gizmoMode: nextMode(gizmoMode) })}>
            {MODE_LABEL[gizmoMode]}
          </button>
        )}
        {isGm && props && !phone && (
          <button type="button" className={`tiny${advanced ? ' on' : ''}`} aria-pressed={advanced} title="Advanced: tilt on every axis, stretch per axis, type exact values (A)" onClick={() => { set({ advanced: !advanced }); if (!advanced && !building) setDetails(true) }}>
            Advanced
          </button>
        )}
        {isGm && props && advanced && !phone && (
          <button type="button" className="tiny" title="Axes of the advanced gizmo: the world's or the prop's own" onClick={() => set({ gizmoSpace: space === 'world' ? 'local' : 'world' })}>
            {space === 'world' ? 'World' : 'Local'}
          </button>
        )}
        {!building && (
          <button type="button" className={`tiny${details ? ' on' : ''}`} aria-expanded={details} onClick={() => setDetails(!details)}>
            Details <Icon name={details ? 'chevron-down' : 'chevron-up'} size={14} />
          </button>
        )}
        <button type="button" className="tiny primary" onClick={done} title={building ? 'Let go of the props (Esc)' : 'Leave edit mode (or double tap)'}>{building ? 'Deselect' : 'Done'}</button>
      </div>
    </div>
  )
}
