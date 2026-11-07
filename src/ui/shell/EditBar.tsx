/**
 * Edit bar: shown over the bottom of the table while edit mode is on (double tap on a token or prop,
 * or "Edit" in its menu). Names what is being edited, toggles snapping, and opens "Details" with the
 * numeric editors (size, model, solid, hide a room part…) and, for the GM, adding props. "Done"
 * (or another double tap) leaves edit mode.
 */
import { useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import { AddProp, Selected } from '../panels/ObjectPanel'

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
    if (sel.kind === 'prop') return s.props[sel.id]?.name ?? null
    if (sel.kind === 'scene') return s.scenes[sel.id]?.name ?? null
    return sel.id
  })
  const snap = useTableUi((s) => s.snap)
  const set = useTableUi((s) => s.set)
  const [details, setDetails] = useState(false)
  const done = () => set({ editMode: false, editPreview: null, editDrag: false })

  return (
    <div className="edit-dock">
      {details && (
        <div className="dock-card edit-details" role="region" aria-label="Edit details">
          {selection && scene && sceneId
            ? <Selected key={`${selection.kind}:${selection.id}`} controller={controller} selection={selection} scene={scene} sceneId={sceneId} onDeselect={() => setSelection(null)} />
            : <p className="muted small">Tap a token or prop{isGm ? ', or a part of the room,' : ''} to edit it.</p>}
          {isGm && sceneId && (
            <div className="edit-details-extra">
              {selection?.kind !== 'scene' && <button type="button" className="tiny" onClick={() => setSelection({ kind: 'scene', id: sceneId })}>Edit the whole scene</button>}
              <AddProp controller={controller} sceneId={sceneId} scene={scene} />
            </div>
          )}
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
        <button type="button" className={`tiny${details ? ' on' : ''}`} aria-expanded={details} onClick={() => setDetails(!details)}>
          Details {details ? '▾' : '▴'}
        </button>
        <button type="button" className="tiny primary" onClick={done} title="Leave edit mode (or double tap)">Done</button>
      </div>
    </div>
  )
}
