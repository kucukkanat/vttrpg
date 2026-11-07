/**
 * "In this scene": the outliner of the shown scene. Tokens, Props and Lights, searched with the
 * Library's search. Clicking a row selects it on the board and frames the camera on it; Shift
 * adds a prop to (or takes it out of) the prop selection. Tokens have a hide toggle; every row
 * deletes. This is the GM's list of tokens in Build.
 */
import { useMemo, useState } from 'react'
import { useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import type { GameController } from '../controller'
import { Icon } from '../icons'
import { hideIntent, removeIntent, sceneOutline, selectOutlineRow, type OutlineRow } from './outlineLogic'

/** Rows drawn per group before "Show all"; big scenes hold hundreds of props. */
const ROW_CAP = 150

export default function Outliner({ controller, query }: { controller: GameController; query: string }) {
  const tokens = useGame((s) => s.tokens)
  const props = useGame((s) => s.props)
  const lights = useGame((s) => s.lights)
  const preview = useTableUi((s) => s.previewScene)
  const live = useGame((s) => s.meta?.activeScene ?? null)
  const selectedTokens = useGame((s) => s.selectedTokens)
  const propSelection = useGame((s) => s.propSelection)
  const scene = preview ?? live
  const outline = useMemo(() => sceneOutline({ tokens, props, lights }, scene, query), [tokens, props, lights, scene, query])
  const selected = useMemo(() => new Set<string>([...selectedTokens, ...propSelection]), [selectedTokens, propSelection])
  const total = outline.tokens.length + outline.props.length + outline.lights.length
  if (!scene) return <p className="muted small lib-empty">Add a scene first.</p>

  const send = (row: OutlineRow, kind: 'hide' | 'remove') => void controller.dispatch(kind === 'hide' ? hideIntent(row) : removeIntent(row))
  return (
    <div className="lib-shelf lib-outliner">
      <div className="lib-scroll">
        {total === 0 && <p className="muted small lib-empty">{query ? `Nothing in this scene matches “${query}”.` : 'Nothing is placed in this scene yet.'}</p>}
        <Group title="Tokens" rows={outline.tokens} selected={selected} onSend={send} />
        <Group title="Props" rows={outline.props} selected={selected} onSend={send} />
        <Group title="Lights" rows={outline.lights} selected={selected} onSend={send} />
        {total > 0 && <p className="muted small lib-hint">Click selects and frames it · Shift-click adds props.</p>}
      </div>
    </div>
  )
}

function Group({ title, rows, selected, onSend }: { title: string; rows: OutlineRow[]; selected: Set<string>; onSend(row: OutlineRow, kind: 'hide' | 'remove'): void }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, ROW_CAP)
  return (
    <section className="lib-section" aria-label={title}>
      <h4 className="lib-section-title">{title} <span className="muted">· {rows.length}</span></h4>
      <ul className="lib-outline">
        {shown.map((r) => (
          <li key={r.id} className={`lib-orow${selected.has(r.id) ? ' on' : ''}${r.hidden ? ' hidden-token' : ''}`}>
            <button type="button" className="lib-orow-pick" aria-pressed={selected.has(r.id)} onClick={(e) => selectOutlineRow(r, { shift: e.shiftKey })}
              title={r.kind === 'prop' ? 'Select and frame it (Shift: add to the selection)' : 'Select and frame it'}>
              <Icon name={r.kind === 'token' ? 'pawn' : r.kind === 'prop' ? 'cube' : 'spark'} size={14} />
              <span className="lib-orow-name">{r.name}</span>
              {r.meta && <span className="lib-orow-meta muted">{r.meta}</span>}
            </button>
            {r.kind === 'token' && (
              <button type="button" className={`icon lib-row-act${r.hidden ? ' on' : ''}`} aria-pressed={!!r.hidden}
                aria-label={r.hidden ? `Reveal ${r.name}` : `Hide ${r.name}`} title={r.hidden ? 'Hidden from players: reveal' : 'Visible: hide from players'}
                onClick={() => onSend(r, 'hide')}>
                <Icon name="eye" size={14} />
              </button>
            )}
            <button type="button" className="icon lib-row-act" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => onSend(r, 'remove')}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && <button type="button" className="tiny" onClick={() => setAll(true)}>Show all {rows.length}</button>}
    </section>
  )
}
