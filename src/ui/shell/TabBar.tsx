/** Phone bottom tab bar: one 44px+ tab per visible panel, badge counts, safe-area padded via CSS. */
import type { PanelDef } from '../panels/registry'

export function TabBar({ panels, active, badges, onSelect }: {
  panels: PanelDef[]
  active: string | null
  badges: Record<string, number>
  onSelect(id: string): void
}) {
  return (
    <nav className="tabbar" aria-label="Panels">
      {panels.map((p) => {
        const n = badges[p.id] ?? 0
        return (
          <button key={p.id} type="button" className={`tab ${active === p.id ? 'on' : ''}`} aria-pressed={active === p.id} onClick={() => onSelect(p.id)}>
            <span className="glyph" aria-hidden>{p.glyph}</span>
            <span className="lbl">{p.short}</span>
            {n > 0 && <span className="badge" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>}
          </button>
        )
      })}
    </nav>
  )
}
