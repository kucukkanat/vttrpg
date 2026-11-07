/**
 * Body of the phone "More" sheet: one 48px row per panel that has no tab of its own (glyph,
 * title, GM marker, unread count), and the build tag as the footer so it no longer floats over
 * content.
 */
import type { PanelDef } from '../panels/registry'
import { BuildTag } from '../BuildTag'
import { Icon } from '../icons'

export function MoreList({ panels, current, badges, onSelect }: {
  panels: PanelDef[]
  /** Panel to mark as the one last opened from this list, if any. */
  current: string | null
  badges: Record<string, number>
  onSelect(id: string): void
}) {
  return (
    <div className="more-body">
      <ul className="more-list">
        {panels.map((p) => {
          const n = badges[p.id] ?? 0
          const on = p.id === current
          return (
            <li key={p.id}>
              <button type="button" className={`more-row ${on ? 'on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => onSelect(p.id)}>
                <span className="glyph" aria-hidden><Icon name={p.glyph} /></span>
                <span className="more-title">{p.title}</span>
                {p.scope === 'gm' && <span className="more-tag">GM</span>}
                {n > 0 && <span className="more-count" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="more-foot">
        <span>Build</span>
        <BuildTag inline />
      </div>
    </div>
  )
}
