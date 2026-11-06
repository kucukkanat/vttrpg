/**
 * Game name, connection status, role, invite (GM), leave. On phones the actions fold into an
 * overflow menu so the bar stays one slim row.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useConnectionStatus } from '../shell/useConnectionStatus'

export function TopBar({ controller, compact = false, trailing }: { controller: GameController; compact?: boolean; trailing?: ReactNode }) {
  const meta = useGame((s) => s.meta)
  const status = useConnectionStatus(controller)
  const isGm = controller.connection.isGm
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(controller.connection.inviteLink())
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch { window.prompt('Invite link', controller.connection.inviteLink()) }
  }
  const leave = () => { controller.dispose(); window.location.hash = '/' }

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [menu])

  const statusLabel = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline'
  return (
    <header className={`topbar ${compact ? 'compact' : ''}`}>
      <strong className="game-name" title={meta?.name}>{meta?.name ?? 'Game'}</strong>
      <span className={`status ${status}`} role="status" aria-label={statusLabel} title={statusLabel}>
        <span className="dot" />
        {!compact && <span className="small">{statusLabel}</span>}
      </span>
      <span className={`role ${isGm ? 'gm' : ''}`}>{isGm ? 'GM' : 'Player'}</span>
      <span className="spacer" />
      {trailing}
      {compact ? (
        <div className="menu" ref={menuRef}>
          <button type="button" className="icon" aria-haspopup="menu" aria-expanded={menu} aria-label="More" onClick={() => setMenu((m) => !m)}>⋯</button>
          {menu && (
            <div className="menu-list" role="menu">
              <div className="menu-info muted small">{statusLabel} · {isGm ? 'GM' : 'Player'}</div>
              {isGm && <button type="button" role="menuitem" onClick={() => { void copy(); }}>{copied ? 'Copied' : 'Copy invite link'}</button>}
              <button type="button" role="menuitem" className="danger" onClick={leave}>Leave game</button>
            </div>
          )}
        </div>
      ) : (
        <>
          {isGm && <button type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy invite link'}</button>}
          <button type="button" onClick={leave}>Leave</button>
        </>
      )}
    </header>
  )
}
