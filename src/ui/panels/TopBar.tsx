/**
 * Game name, connection status, role, invite (GM), leave. On phones the actions fold into an
 * overflow menu so the bar stays one slim row. The invite opens a popover with the link in a
 * read-only field and a Copy button; on phones it is a full-width panel under the bar.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useConnectionStatus } from '../shell/useConnectionStatus'
import { buildInviteUrl, relayStatusLine, selectAll, useCopy } from '../invite'
import './invite.css'

export function TopBar({ controller, compact = false, trailing }: { controller: GameController; compact?: boolean; trailing?: ReactNode }) {
  const meta = useGame((s) => s.meta)
  const status = useConnectionStatus(controller)
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
          {invite && <InvitePopover controller={controller} status={status} onClose={closeInvite} containerRef={inviteRef} />}
        </div>
      )}
    </header>
  )
}

function InvitePopover({ controller, status, onClose, containerRef }: {
  controller: GameController
  status: ReturnType<typeof useConnectionStatus>
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
  const open = status === 'offline' ? 0 : controller.connection.relayCount
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
        {status === 'connecting' ? 'Connecting to the relays…' : relayStatusLine(open, total)}
      </p>
    </div>
  )
}
