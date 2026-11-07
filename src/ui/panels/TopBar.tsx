/**
 * The top rail of the table: the game's plaque (name, connection, role), the live scene, a centre
 * slot for the combat control, then `trailing` (presence, bell, search, menu from the shell). The
 * GM's Invite sits with the presence row; on phones it moves into the shell's menu, which asks for
 * the popover with `requestInvite()`. Offline and role-change banners hang under the bar.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useConnectionStatus, type ConnectionStatus } from '../shell/useConnectionStatus'
import { buildInviteUrl, RELAY_HEALTH_HINT, relayHealth, relayStatusLine, selectAll, useCopy } from '../invite'
import { reopenInRole, roleLabel, useAuthority } from '../authority'
import { RelayPopover } from './RelayStatus'
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

const INVITE_EVENT = 'vtt:invite'

/** Open the GM's invite popover from elsewhere (the phone menu, the command palette). */
export function requestInvite() {
  window.dispatchEvent(new Event(INVITE_EVENT))
}

export function TopBar({ controller, compact = false, center, trailing, onScene }: {
  controller: GameController
  compact?: boolean
  center?: ReactNode
  trailing?: ReactNode
  /** GM: the scene title opens the scene list. */
  onScene?(): void
}) {
  const meta = useGame((s) => s.meta)
  const sceneName = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene]?.name : undefined))
  const { status, gmAway, relaysOpen, relaysTotal } = useConnectionStatus(controller)
  const isGm = controller.connection.isGm
  const { role, needsReopen } = useAuthority(controller)
  // The role this connection runs in (a grant or revocation shows the reopen banner instead).
  const shownRole = isGm ? (controller.connection.gm === controller.pubkey ? 'gm' : 'co-gm') : 'player'
  const [invite, setInvite] = useState(false)
  const [relaysOpenList, setRelaysOpenList] = useState(false)
  const relayRef = useRef<HTMLDivElement>(null)
  const inviteRef = useRef<HTMLDivElement>(null)
  const inviteButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isGm) return
    const on = () => setInvite(true)
    window.addEventListener(INVITE_EVENT, on)
    return () => window.removeEventListener(INVITE_EVENT, on)
  }, [isGm])

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
      <div className="t-plaque-name">
        <span className="t-crest" aria-hidden />
        <span className="t-plaque-text">
          <strong className="game-name" title={meta?.name}>{meta?.name ?? 'Game'}</strong>
          <span className="t-plaque-sub">
            <span className="relay-anchor" ref={relayRef}>
              <button type="button" className={`status ${status}${showAway ? ' gm-away' : ''}${degraded ? ' degraded' : ''}`} aria-label={`${statusLabel}. Show relays`} title={statusLabel}
                aria-haspopup="dialog" aria-expanded={relaysOpenList} onClick={() => setRelaysOpenList((o) => !o)}>
                <span className="dot" />
                <span className="small word" role="status">{statusLabel}</span>
              </button>
              {relaysOpenList && <RelayPopover controller={controller} onClose={() => setRelaysOpenList(false)} containerRef={relayRef} />}
            </span>
            <span className={`role ${isGm ? 'gm' : ''}`}>{roleLabel(shownRole)}</span>
          </span>
        </span>
      </div>
      {!compact && sceneName && (
        isGm && onScene ? (
          <button type="button" className="t-scene" onClick={onScene} title="The scene: switch, add, and its settings">
            <span className="t-scene-label">Scene</span>
            <span className="t-scene-name">{sceneName}</span>
          </button>
        ) : (
          <span className="t-scene">
            <span className="t-scene-label">Scene</span>
            <span className="t-scene-name">{sceneName}</span>
          </span>
        )
      )}
      <span className="spacer" />
      {center && <div className="t-center">{center}</div>}
      <span className="spacer" />
      {isGm && !compact && (
        <button type="button" className="t-invite" ref={inviteButtonRef} aria-haspopup="dialog" aria-expanded={invite} onClick={() => (invite ? closeInvite() : setInvite(true))}>Invite</button>
      )}
      {trailing}
      {isGm && (
        <div className="invite-anchor" ref={inviteRef}>
          {invite && <InvitePopover controller={controller} status={status} open={relaysOpen} onClose={closeInvite} containerRef={inviteRef} />}
        </div>
      )}
      {needsReopen && (
        <div className="offline-banner" role="status">
          <span className="dot" aria-hidden="true" style={{ background: 'var(--accent)' }} />
          <span>{role === 'player' ? 'The GM ended your co-GM access; your edits no longer reach the table.' : 'The GM made you a co-GM. Reopen the game to get the GM tools.'}</span>
          <button type="button" onClick={() => reopenInRole(controller, role)}>Reopen</button>
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
