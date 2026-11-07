/**
 * Relay status list, opened from the top bar's status pill: every relay the game uses with its
 * state, when a down relay retries next, and why it last failed. "Retry now" skips the backoff.
 * The GM sees a note when reserve relays were brought in (relay rotation, see src/net/relays.ts).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { gradeRelay, type RelayGrade, type RelayHealth } from '@/net'
import type { GameController } from '../controller'
import { relayHost } from '../invite'

export const RELAY_LIST_POLL_MS = 1000

const css = `
.relay-pop { position: absolute; left: 0; top: calc(100% + 4px); width: 360px; max-width: calc(100vw - 2 * var(--sp-3)); z-index: 40;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-3);
  display: grid; gap: var(--sp-2); box-shadow: var(--shadow-lg); text-align: left; }
.relay-pop p { margin: 0; }
.relay-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.relay-list li { display: grid; grid-template-columns: auto 1fr; column-gap: var(--sp-2); align-items: center; min-height: 36px; }
.relay-list .dot { width: 8px; height: 8px; }
.relay-list .good .dot { background: var(--ok); }
.relay-list .connecting .dot { background: var(--accent); }
.relay-list .refusing .dot { background: var(--accent); }
.relay-list .down .dot { background: var(--bad); }
.relay-list .host { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relay-list .why { grid-column: 2; color: var(--muted); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relay-anchor { position: relative; flex: none; display: inline-flex; }
.relay-anchor > .status { background: none; border: 0; padding: 0 4px; min-height: 32px; cursor: pointer; color: inherit; }
@media (max-width: 699.98px) {
  .relay-anchor { position: static; }
  .relay-pop { position: fixed; left: 0; right: 0; top: var(--topbar-h); width: auto; max-width: none; border-radius: 0 0 var(--r-lg) var(--r-lg); border-top: 0; }
}
`

const WORD: Record<RelayGrade, string> = { good: 'Working', refusing: 'Refusing writes', connecting: 'Connecting…', down: 'Down' }

/** One line of detail under a relay: retry countdown, last error, publish counts. Pure for tests. */
export function relayDetail(h: RelayHealth, now: number): string {
  const grade = gradeRelay(h)
  const parts: string[] = []
  if (grade === 'down' && h.nextRetryAt) parts.push(`retry in ${Math.max(0, Math.ceil((h.nextRetryAt - now) / 1000))}s`)
  if (grade === 'down' && h.failures > 1) parts.push(`${h.failures} failed attempts`)
  if (grade === 'refusing') parts.push(`${h.rejectStreak} writes refused in a row`)
  if ((grade === 'down' || grade === 'refusing') && h.lastError) parts.push(h.lastError.replace(/^connect failed: /, '').slice(0, 80))
  if (grade === 'good' && h.publishOk + h.publishFailed > 0) parts.push(`${h.publishOk} sent${h.publishFailed ? `, ${h.publishFailed} refused` : ''}`)
  return parts.join(' · ')
}

export function RelayPopover({ controller, onClose, containerRef }: { controller: GameController; onClose(): void; containerRef: RefObject<HTMLElement | null> }) {
  const [health, setHealth] = useState<RelayHealth[]>(() => controller.connection.relayHealth?.() ?? [])
  const [now, setNow] = useState(() => Date.now())
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const read = () => { setHealth(controller.connection.relayHealth?.() ?? []); setNow(Date.now()) }
    read()
    const id = setInterval(read, RELAY_LIST_POLL_MS)
    return () => clearInterval(id)
  }, [controller])
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!containerRef.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const id = setTimeout(() => window.addEventListener('pointerdown', close), 0)
    window.addEventListener('keydown', esc)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [onClose, containerRef])

  const good = health.filter((h) => gradeRelay(h) === 'good').length
  const anyDown = health.some((h) => gradeRelay(h) === 'down')
  return (
    <div className="relay-pop" role="dialog" aria-label="Relays">
      <style>{css}</style>
      <div className="invite-head">
        <strong>Relays · {good}/{health.length} working</strong>
        <button ref={closeRef} type="button" className="icon invite-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <ul className="relay-list">
        {health.map((h) => {
          const grade = gradeRelay(h)
          const detail = relayDetail(h, now)
          return (
            <li key={h.url} className={grade}>
              <span className="dot" aria-hidden="true" />
              <span className="host" title={h.url}>{relayHost(h.url)} <span className="muted small">· {WORD[grade]}</span></span>
              {detail && <span className="why">{detail}</span>}
            </li>
          )
        })}
      </ul>
      <p className="invite-hint">
        Messages go to every working relay; down ones retry by themselves with growing pauses.
        {controller.connection.isGm && ' When too few work, spare relays are added and players follow them.'}
      </p>
      {anyDown && <button type="button" onClick={() => controller.connection.reconnect()}>Retry now</button>}
    </div>
  )
}
