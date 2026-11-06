/**
 * First-visit orientation for a GM: one card over the table that says what to do next, shown
 * once per device (dismissing it is remembered in localStorage). Bottom-centre on desktop and
 * tablet; on phones it hangs under the top bar so it stays clear of the bottom sheet and tab bar.
 * It never covers the whole table and the only control is a 44 px Dismiss.
 */
import { useState } from 'react'
import { useBreakpoint } from '../shell/useBreakpoint'

export const GM_CALLOUT_KEY = 'vtt.onboarding.gm'

export const GM_CALLOUT_TEXT = "You're the GM: copy the invite link, players pick a token. Try casting a skill on the rat."

/** True once the card has been dismissed on this device. */
export function gmCalloutSeen(): boolean {
  try { return localStorage.getItem(GM_CALLOUT_KEY) === '1' } catch { return true }
}

function markSeen() {
  try { localStorage.setItem(GM_CALLOUT_KEY, '1') } catch { /* private mode, quota */ }
}

const css = `
.gm-callout {
  position: absolute; z-index: 5; left: 50%; transform: translateX(-50%);
  width: max-content; max-width: min(520px, calc(100% - var(--sp-4) * 2 - var(--sal) - var(--sar)));
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4); border-radius: var(--r-md);
  background: rgba(23, 23, 27, .92); border: 1px solid var(--accent); color: var(--fg);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: gm-callout-in .25s ease;
}
.gm-callout--bottom { bottom: calc(var(--sp-4) + var(--sab)); }
.gm-callout--top { top: var(--sp-2); }
.gm-callout p { margin: 0; font-size: var(--fs-md); line-height: 1.4; }
.gm-callout p strong { color: var(--accent); }
.gm-callout button { flex: none; min-width: 44px; min-height: 44px; padding: 0 var(--sp-3); border-radius: var(--r-md); }
@keyframes gm-callout-in { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-reduced-motion: reduce) { .gm-callout { animation: none; } }
`

export function GmCallout() {
  const bp = useBreakpoint()
  const [open, setOpen] = useState(() => !gmCalloutSeen())
  if (!open) return null
  const dismiss = () => { markSeen(); setOpen(false) }
  const [lead, ...rest] = GM_CALLOUT_TEXT.split(': ')
  return (
    <aside className={`gm-callout gm-callout--${bp === 'phone' ? 'top' : 'bottom'}`} role="status" aria-label="Getting started">
      <style>{css}</style>
      <p><strong>{lead}:</strong> {rest.join(': ')}</p>
      <button type="button" onClick={dismiss} aria-label="Dismiss getting started tip">Dismiss</button>
    </aside>
  )
}
