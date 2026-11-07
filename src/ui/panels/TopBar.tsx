/**
 * Game name, connection status, role, invite (GM), leave. On phones the actions fold into an
 * overflow menu so the bar stays one slim row. The invite opens a popover with the link in a
 * read-only field and a Copy button; on phones it is a full-width panel under the bar.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useConnectionStatus, type ConnectionStatus } from '../shell/useConnectionStatus'
import { buildInviteUrl, RELAY_HEALTH_HINT, relayHealth, relayStatusLine, selectAll, useCopy } from '../invite'
import { Icon } from '../icons'
import './invite.css'

const css = `
.topbar { position: relative; }
.status.gm-away .dot, .status.degraded .dot { background: var(--accent); }
.offline-banner {
  position: absolute; left: 0; right: 0; top: 100%; z-index: 8;
  display: flex; align-items: center; gap: var(--sp-2); min-height: 44px;
  padding: 0 calc(var(--sp-3) + var(--sar)) 0 calc(var(--sp-3) + var(--sal));
  background: var(--panel-2); border-bottom: 1px solid var(--border); color: var(--fg); font-size: var(--fs-sm);
}
.offline-banner .dot { background: var(--bad); width: 8px; height: 8px; }
.offline-banner span { min-width: 0; flex: 1 1 auto; }
.offline-banner button { min-height: 44px; min-width: 44px; flex: none; }
`

export function TopBar({ controller, compact = false, trailing }: { controller: GameController; compact?: boolean; trailing?: ReactNode }) {
  const meta = useGame((s) => s.meta)
  const { status, gmAway, relaysOpen, relaysTotal } = useConnectionStatus(controller)
  const isGm = controller.connection.isGm
  const [menu, setMenu] = useState(false)
  const [invite, setInvite] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inviteRef = useRef<HTMLDivElement>(null)
  const inviteButtonRef = useRef<HTMLButtonElement>(null)

  const leave = () => { controller.dispose(); window.location.hash = '/' }

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [menu])

  const openInvite = () => { setMenu(false); setInvite(true) }
  const closeInvite = () => { setInvite(false); inviteButtonRef.current?.focus() }

  // A player with relays but no GM beacon for a while sees amber "GM away"; the GM never does.
  const showAway = status === 'connected' && gmAway && !isGm
  // Fewer than half of the relays open: amber, with the count, so a GM knows why players lag.
  const health = relayHealth(relaysOpen, relaysTotal)
  const degraded = status === 'connected' && !showAway && health.level === 'degraded'
  const statusLabel = status === 'connected'
    ? (showAway ? 'Connected · GM away' : degraded ? `Connected · ${health.open}/${health.total} relays` : 'Connected')
    : status === 'connecting' ? 'Connecting…' : 'Offline'
  const retry = () => controller.connection.reconnect()
  return (
    <header className={`topbar ${compact ? 'compact' : ''}`}>
      <style>{css}</style>
      <strong className="game-name" title={meta?.name}>{meta?.name ?? 'Game'}</strong>
      <span className={`status ${status}${showAway ? ' gm-away' : ''}${degraded ? ' degraded' : ''}`} role="status" aria-label={statusLabel} title={statusLabel}>
        <span className="dot" />
        <span className="small word">{statusLabel}</span>
      </span>
      <span className={`role ${isGm ? 'gm' : ''}`}>{isGm ? 'GM' : 'Player'}</span>
      <span className="spacer" />
      {trailing}
      {compact ? (
        <div className="menu" ref={menuRef}>
          <button type="button" className="icon" aria-haspopup="menu" aria-expanded={menu} aria-label="More" onClick={() => setMenu((m) => !m)}><Icon name="more" /></button>
          {menu && (
            <div className="menu-list" role="menu">
              <div className="menu-info muted small">{statusLabel} · {isGm ? 'GM' : 'Player'}</div>
              {isGm && <button type="button" role="menuitem" ref={inviteButtonRef} onClick={openInvite}>Invite players</button>}
              <button type="button" role="menuitem" className="danger" onClick={leave}>Leave game</button>
            </div>
          )}
        </div>
      ) : (
        <>
          {isGm && <button type="button" ref={inviteButtonRef} aria-haspopup="dialog" aria-expanded={invite} onClick={() => (invite ? closeInvite() : openInvite())}>Invite</button>}
          <button type="button" onClick={leave}>Leave</button>
        </>
      )}
      {isGm && (
        <div className="invite-anchor" ref={inviteRef}>
          {invite && <InvitePopover controller={controller} status={status} open={relaysOpen} onClose={closeInvite} containerRef={inviteRef} />}
        </div>
      )}
      {status === 'offline' && (
        <div className="offline-banner" role="status">
          <span className="dot" aria-hidden="true" />
          <span>Offline · changes stay on this device</span>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}
    </header>
  )
}

function InvitePopover({ controller, status, open, onClose, containerRef }: {
  controller: GameController
  status: ConnectionStatus
  /** Relays open right now, kept live by the top bar. */
  open: number
  onClose: () => void
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const link = buildInviteUrl(controller.connection)
  const { state, copy } = useCopy(link)
  const inputRef = useRef<HTMLInputElement>(null)
  const copyRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { copyRef.current?.focus() }, [])

  useEffect(() => {
    const close = (e: PointerEvent) => { if (!containerRef.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    // Deferred so the tap that opened the popover does not close it again.
    const id = setTimeout(() => window.addEventListener('pointerdown', close), 0)
    window.addEventListener('keydown', esc)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [onClose, containerRef])

  const onCopy = async () => {
    const ok = await copy()
    if (!ok) selectAll(inputRef.current)
  }

  const total = controller.connection.relays.length
  const health = relayHealth(status === 'offline' ? 0 : open, total)
  return (
    <div className="invite-pop" role="dialog" aria-label="Invite players">
      <div className="invite-head">
        <strong>Invite players</strong>
        <button type="button" className="icon invite-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="invite-row">
        <input ref={inputRef} readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button ref={copyRef} type="button" className="primary" onClick={() => void onCopy()} aria-live="polite">
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {state === 'failed' && <p className="invite-failed" role="alert">Copy is blocked here. The link is selected: press Ctrl/⌘+C or long-press it.</p>}
      <p className="invite-hint">Players open this in any browser, no account needed.</p>
      <p className={`invite-relays status ${status}`}>
        <span className="dot" />
        {status === 'connecting' ? 'Connecting to the relays…' : relayStatusLine(health.open, health.total)}
      </p>
      {status !== 'connecting' && health.level !== 'good' && <p className="invite-hint">{RELAY_HEALTH_HINT}</p>}
    </div>
  )
}
