/**
 * Phone bottom tab bar: four panel slots plus "More", which opens a sheet listing every other
 * panel. Five tabs always fit (64px each at 320px), so nothing is clipped. Badges on a hidden
 * panel roll up onto More; while a More panel is open the More tab is lit and carries its label.
 */
import { MORE_ID, sumBadges, type PhoneTabs } from './phoneTabs'
import { Icon, type IconName } from '../icons'

export function TabBar({ tabs, active, badges, onSelect, onMore }: {
  tabs: PhoneTabs
  /** Open panel id, `MORE_ID` while the More list is showing, or null when the sheet is closed. */
  active: string | null
  badges: Record<string, number>
  onSelect(id: string): void
  onMore(): void
}) {
  const inMore = tabs.more.find((p) => p.id === active)
  const moreOn = active === MORE_ID || !!inMore
  return (
    <nav className="tabbar" aria-label="Panels">
      {tabs.primary.map((p) => (
        <Tab key={p.id} glyph={p.glyph} label={p.short} title={p.title} on={active === p.id} badge={badges[p.id] ?? 0} onClick={() => onSelect(p.id)} />
      ))}
      {tabs.more.length > 0 && (
        <Tab glyph="more" label={inMore?.short ?? 'More'} title={inMore ? `More: ${inMore.title}` : 'More panels'} on={moreOn} badge={sumBadges(tabs.more, badges)} onClick={onMore} />
      )}
    </nav>
  )
}

function Tab({ glyph, label, title, on, badge, onClick }: {
  glyph: IconName
  label: string
  title: string
  on: boolean
  badge: number
  onClick(): void
}) {
  return (
    <button type="button" className={`tab ${on ? 'on' : ''}`} aria-pressed={on} aria-label={badge > 0 ? `${title}, ${badge} unread` : title} onClick={onClick}>
      <span className="glyph" aria-hidden><Icon name={glyph} /></span>
      <span className="lbl">{label}</span>
      {badge > 0 && <span className="badge" aria-hidden>{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}
