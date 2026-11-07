/**
 * The GM drawer on the plaque: one button that fans out the table-time references, each
 * with its live state (drawerItems.ts), each opening as the one card. Players never see it.
 */
import { useMemo, useRef, useState } from 'react'
import { useGame } from '@/state/store'
import { useTableLayout } from './tableLayout'
import { useEscape, useOutside } from './TableChrome'
import { drawerButtonLabel, drawerItems } from './drawerItems'
import { Icon } from '../icons'
import './GmDrawer.css'

/** Open a drawer item as the one card (always a card, whatever the old Prep routes say). */
export function openDrawerCard(panel: string): void {
  useTableLayout.getState().set({ card: panel })
}

export function GmDrawer({ me, playing, journalNew }: { me: string; playing: number; journalNew: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const presence = useGame((s) => s.presence)
  const stored = useGame((s) => s.encounters)
  const here = useMemo(() => Object.keys(presence).filter((pk) => pk !== me).length, [presence, me])
  const encounters = useMemo(() => Object.values(stored ?? {}), [stored])
  const items = drawerItems({ playing, here, journalNew, encounters })
  useOutside(open, ref, () => setOpen(false))
  useEscape(open, () => setOpen(false))
  const waiting = items.some((i) => i.attention)
  return (
    <div className="t-drawer" ref={ref}>
      <button type="button" className={`t-drawer-btn${open ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={drawerButtonLabel(items)} title="GM drawer: sound, players, journal, tables, NPC, encounters, credits" onClick={() => setOpen((o) => !o)}>
        <Icon name="toolbox" size={18} />
        <span className="t-drawer-word">Drawer</span>
        {waiting && <span className="t-drawer-dot" aria-hidden />}
      </button>
      {open && (
        <div className="t-drawer-fan" role="menu" aria-label="GM drawer">
          {items.map((it, i) => (
            <button key={it.panel} type="button" role="menuitem" className={`t-drawer-item${it.attention ? ' has' : ''}`} style={{ ['--i' as string]: i }}
              onClick={() => { setOpen(false); openDrawerCard(it.panel) }}>
              <Icon name={it.glyph} size={20} />
              <span className="t-drawer-label">{it.label}</span>
              <span className="t-drawer-state">{it.state || ' '}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
