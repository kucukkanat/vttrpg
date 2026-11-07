/**
 * One-time gesture tips: a small bubble with an arrow, pointing at the control (or the token) the
 * tip is about, shown the moment it matters. At most one at a time, never over the bottom bar's
 * buttons, and each is retired for good (localStorage) once the viewer does the thing or closes
 * the bubble. A tip whose target is not on screen is not shown; it waits for the target.
 * Which tip is due lives in tips.ts (pure, tested).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GameController } from '../controller'
import { firstOwnedToken, useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import { useTargeting } from '../targeting'
import { currentEntry } from '../panels/initiative'
import { dueTip, markTipSeen, placeBubble, readSeenTips, TIP_ORDER, TIP_TEXT, type Box, type Placement, type Side, type TipId } from './tips'

/** A tip must stay due this long before it shows, so it never flashes during a pan or a re-layout. */
const SETTLE_MS = 700
/** How often targets are re-measured (they appear, move and re-layout without telling us). */
const POLL_MS = 400
const GAP = 12
/** The selected token sits at the table's centre (the camera pans to it); leave it visible. */
const TOKEN_GAP = 40
const MARGIN = 8

const SIDE: Record<TipId, Side> = { 'your-turn': 'above', 'token-bar': 'above', 'long-press': 'above', 'edit-gesture': 'above', dice: 'left' }

function endTurnButton(): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>('.token-bar .end-turn')
  if (marked) return marked
  return Array.from(document.querySelectorAll<HTMLElement>('.token-bar button')).find((b) => b.textContent?.trim() === 'End turn') ?? null
}

function targetOf(id: TipId): Element | null {
  switch (id) {
    case 'your-turn': return endTurnButton()
    case 'token-bar': return document.querySelector('.dock .token-bar')
    case 'long-press':
    case 'edit-gesture': return document.querySelector('.table canvas')
    case 'dice': return document.querySelector('.cam-dice')
  }
}

const toBox = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height })

/** The box the bubble points at, or null when the target is missing, hidden or covered. */
function measure(id: TipId): Box | null {
  const el = targetOf(id)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return null
  // Covered by a sheet, drawer or menu: whatever is on top at the centre must be the target.
  const hit = document.elementFromPoint(cx, cy)
  if (hit && hit !== el && !el.contains(hit) && !hit.closest('.onboarding-tip')) return null
  // A box around the token, so the bubble (GAP away from it) clears the token on any side.
  if (id === 'long-press' || id === 'edit-gesture') return { left: cx, top: cy - (TOKEN_GAP - GAP), width: 0, height: 2 * (TOKEN_GAP - GAP) }
  return toBox(r)
}

function obstacles(): Box[] {
  return Array.from(document.querySelectorAll('.dock .dock-bar, .dock .dock-card, .tabbar'))
    .map((el) => toBox(el.getBoundingClientRect()))
    .filter((b) => b.width > 0 && b.height > 0)
}

function safeInsets(probe: HTMLElement | null) {
  const cs = probe ? getComputedStyle(probe) : null
  const px = (v: string | undefined) => parseFloat(v ?? '') || 0
  return {
    top: px(cs?.paddingTop) + MARGIN, right: px(cs?.paddingRight) + MARGIN,
    bottom: px(cs?.paddingBottom) + MARGIN, left: px(cs?.paddingLeft) + MARGIN,
  }
}

interface Scan { anchors: Partial<Record<TipId, Box>>; calloutOpen: boolean; key: string }

function scan(): Scan {
  const anchors: Partial<Record<TipId, Box>> = {}
  for (const id of TIP_ORDER) {
    const b = measure(id)
    if (b) anchors[id] = b
  }
  const calloutOpen = !!document.querySelector('.gm-callout')
  const key = JSON.stringify([anchors, calloutOpen, window.innerWidth, window.innerHeight])
  return { anchors, calloutOpen, key }
}

function useScan(): Scan {
  const [state, setState] = useState<Scan>(() => ({ anchors: {}, calloutOpen: false, key: '' }))
  useEffect(() => {
    const tick = () => {
      const next = scan()
      setState((prev) => (prev.key === next.key ? prev : next))
    }
    tick()
    const iv = window.setInterval(tick, POLL_MS)
    window.addEventListener('resize', tick)
    window.visualViewport?.addEventListener('resize', tick)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('resize', tick)
      window.visualViewport?.removeEventListener('resize', tick)
    }
  }, [])
  return state
}

const css = `
.onboarding-tip {
  position: fixed; z-index: 50; left: 0; top: 0;
  width: max-content; max-width: min(280px, calc(100vw - 32px));
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-1) var(--sp-2) var(--sp-3); border-radius: var(--r-md);
  background: rgba(23, 23, 27, .95); border: 1px solid var(--accent); color: var(--fg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
  animation: onboarding-tip-in .2s ease;
}
.onboarding-tip.measuring { visibility: hidden; animation: none; }
.onboarding-tip p { margin: 0; font-size: var(--fs-md); line-height: 1.35; min-width: 0; overflow-wrap: anywhere; }
.onboarding-tip button {
  flex: none; width: var(--control); height: var(--control); min-width: var(--control); min-height: var(--control);
  padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; border-radius: var(--r-sm);
}
.onboarding-tip button:hover, .onboarding-tip button:focus-visible { color: var(--fg); }
.onboarding-tip-arrow {
  position: absolute; width: 10px; height: 10px; background: rgba(23, 23, 27, .95);
  border: 1px solid var(--accent); transform: rotate(45deg); pointer-events: none;
}
.onboarding-tip--above .onboarding-tip-arrow { bottom: -6px; margin-left: -5px; border-top: 0; border-left: 0; }
.onboarding-tip--below .onboarding-tip-arrow { top: -6px; margin-left: -5px; border-bottom: 0; border-right: 0; }
.onboarding-tip--left .onboarding-tip-arrow { right: -6px; margin-top: -5px; border-bottom: 0; border-left: 0; }
.onboarding-tip-safe {
  position: fixed; inset: 0; visibility: hidden; pointer-events: none;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
}
@keyframes onboarding-tip-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .onboarding-tip { animation: none; } }
`

function Bubble({ id, anchor, onClose }: { id: TipId; anchor: Box; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Placement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const next = placeBubble({
      anchor, gap: GAP, side: SIDE[id],
      size: { width: Math.ceil(r.width), height: Math.ceil(r.height) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      inset: safeInsets(probe.current),
      obstacles: obstacles(),
    })
    setPlace((prev) => (prev && next && prev.left === next.left && prev.top === next.top && prev.side === next.side && prev.arrow === next.arrow ? prev : next))
  }, [id, anchor])

  const arrowStyle = place ? (place.side === 'left' ? { top: place.arrow } : { left: place.arrow }) : undefined
  return createPortal(
    <>
      <style>{css}</style>
      <div ref={probe} className="onboarding-tip-safe" aria-hidden="true" />
      <aside ref={ref} role="status" aria-live="polite" aria-label="Tip"
        className={`onboarding-tip onboarding-tip--${place?.side ?? 'above'}${place ? '' : ' measuring'}`}
        style={place ? { left: place.left, top: place.top } : undefined}>
        <p>{TIP_TEXT[id]}</p>
        <button type="button" onClick={onClose} aria-label="Dismiss tip" title="Dismiss">×</button>
        <span className="onboarding-tip-arrow" style={arrowStyle} />
      </aside>
    </>,
    document.body,
  )
}

export function OnboardingTips({ controller }: { controller: GameController }) {
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const ownsToken = useGame((s) => !isGm && !!firstOwnedToken(s, me))
  const tokenSelected = useGame((s) => s.selectedToken !== null)
  const editableSelected = useGame((s) => s.selection?.kind === 'token' || s.selection?.kind === 'prop')
  const myTurn = useGame((s) => {
    const cur = currentEntry(s.initiative)
    return !isGm && !!cur && s.tokens[cur.token]?.owner === me
  })
  const menuOpen = useTableUi((s) => s.contextMenu !== null)
  const editMode = useTableUi((s) => s.editMode)
  const aiming = useTargeting((s) => s.pending !== null)

  const [seen, setSeen] = useState<ReadonlySet<TipId>>(readSeenTips)
  const retire = useCallback((id: TipId) => {
    markTipSeen(id)
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  // Doing the thing retires its tip, whether or not the bubble was showing.
  useEffect(() => { if (menuOpen) retire('long-press') }, [menuOpen, retire])
  useEffect(() => { if (editMode) retire('edit-gesture') }, [editMode, retire])
  useEffect(() => { if (aiming) retire('token-bar') }, [aiming, retire])
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t?.closest) return
      if (t.closest('.cam-dice')) retire('dice')
      const end = endTurnButton()
      if (end && (t === end || end.contains(t))) retire('your-turn')
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [retire])

  const { anchors, calloutOpen } = useScan()
  const due = dueTip({
    isGm, ownsToken, tokenSelected, editableSelected, myTurn,
    busy: menuOpen || editMode || aiming || calloutOpen,
    targets: new Set(TIP_ORDER.filter((id) => anchors[id])),
    seen,
  })

  const [shown, setShown] = useState<TipId | null>(null)
  useEffect(() => {
    setShown(null)
    if (!due) return
    const t = window.setTimeout(() => setShown(due), SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [due])

  const anchor = shown && shown === due ? anchors[shown] : undefined
  if (!shown || !anchor) return null
  return <Bubble id={shown} anchor={anchor} onClose={() => retire(shown)} />
}
