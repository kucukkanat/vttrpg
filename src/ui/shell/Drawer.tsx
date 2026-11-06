/**
 * Tablet right drawer: a tab strip across the top (one tab per visible panel), then a title row
 * with the panel's own actions plus pin and hide, then the active panel. Pinned = docked in the
 * grid (the table shrinks); unpinned = floats over the table's right edge.
 */
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { PanelHost } from './PanelHost'

export function Drawer({ panels, active, badges, pinned, controller, onSelect, onPin, onClose }: {
  panels: PanelDef[]
  active: string
  badges: Record<string, number>
  pinned: boolean
  controller: GameController
  onSelect(id: string): void
  onPin(pinned: boolean): void
  onClose(): void
}) {
  const def = panels.find((p) => p.id === active) ?? panels[0]
  if (!def) return null
  const head = (
    <div className="drawer-head">
      <h2 className="host-title">{def.title}</h2>
      <span className="spacer" />
      <button type="button" className={`icon pin ${pinned ? 'on' : ''}`} aria-pressed={pinned} aria-label={pinned ? 'Unpin drawer' : 'Pin drawer open'} title={pinned ? 'Unpin: float over the table' : 'Pin: dock beside the table'} onClick={() => onPin(!pinned)}>📌</button>
      <button type="button" className="icon" aria-label="Hide drawer" onClick={onClose}>✕</button>
    </div>
  )
  return (
    <aside className={`drawer ${pinned ? 'pinned' : 'floating'}`} aria-label="Panels">
      <div className="drawer-tabs" role="tablist">
        {panels.map((p) => {
          const n = badges[p.id] ?? 0
          return (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === def.id} className={`tab ${p.id === def.id ? 'on' : ''}`} onClick={() => onSelect(p.id)}>
              <span className="glyph" aria-hidden>{p.glyph}</span>
              <span className="lbl">{p.short}</span>
              {n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}
            </button>
          )
        })}
      </div>
      <PanelHost key={def.id} def={def} controller={controller} head={head} />
    </aside>
  )
}
