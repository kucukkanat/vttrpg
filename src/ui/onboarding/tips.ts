/**
 * One-time gesture tips: which one is due, where its bubble goes, and which ones this device has
 * already retired. Pure apart from the localStorage helpers, so the rules are unit tested;
 * OnboardingTips.tsx gathers the facts from the stores and the DOM and renders the bubble.
 */

export type TipId =
  | 'your-turn' | 'token-bar' | 'long-press' | 'edit-gesture' | 'dice'
  /** The first time editing: pick up, turn, put down, undo, paste. */
  | 'build-pickup' | 'build-turn' | 'build-putdown' | 'build-undo' | 'build-paste'

/** The editing tips, in the order a first time meets them. */
export const BUILD_TIPS: readonly TipId[] = ['build-pickup', 'build-turn', 'build-putdown', 'build-undo', 'build-paste']

export const TIP_TEXT: Record<TipId, string> = {
  'your-turn': "It's your turn: use a skill, then End turn.",
  'token-bar': "Your character's skills and saves are in the bar below. Tap a skill to aim it.",
  'long-press': 'Long-press (or right-click) a token for more actions.',
  'edit-gesture': 'Double-tap a token or prop to move, turn and resize it.',
  dice: 'Roll dice here.',
  'build-pickup': 'Pick a model up from the Library, then click the board to place it.',
  'build-turn': 'R or the mouse wheel turns the model in your hand (Shift: 90°).',
  'build-putdown': 'Esc or right-click puts the model down.',
  'build-undo': 'Placed one too many? Ctrl/⌘-Z undoes it.',
  'build-paste': 'Ctrl/⌘-C copies the selection; Ctrl/⌘-V puts the copy in your hand to place.',
}

/** First match wins: the time-critical tip, then the ones about what is on screen right now. */
export const TIP_ORDER: readonly TipId[] = ['your-turn', 'token-bar', ...BUILD_TIPS, 'long-press', 'edit-gesture', 'dice']

export interface TipFacts {
  isGm: boolean
  /** A player who owns at least one token. */
  ownsToken: boolean
  /** Some token is selected on the table. */
  tokenSelected: boolean
  /** A token or a prop is selected (the GM's edit gesture applies to both). */
  editableSelected: boolean
  /** Initiative is running and the current combatant is one of the viewer's tokens. */
  myTurn: boolean
  /** Something else owns the viewer's attention: a menu, aiming, edit mode, another callout. */
  busy: boolean
  /** Tips whose target is on screen and unobscured right now. */
  targets: ReadonlySet<TipId>
  /** Tips retired on this device. */
  seen: ReadonlySet<TipId>
  /** The GM's Edit toggle is on. */
  building?: boolean
  /** A model is in hand (the place tool). */
  holding?: boolean
  /** Something was placed while editing. */
  placed?: boolean
  /** Props are selected. */
  propSelected?: boolean
  /** A keyboard and mouse (fine pointer): the key and wheel tips make sense. */
  keyboard?: boolean
}

function wanted(id: TipId, f: TipFacts): boolean {
  switch (id) {
    case 'your-turn': return !f.isGm && f.myTurn
    case 'token-bar': return !f.isGm && f.ownsToken
    case 'long-press': return f.tokenSelected
    case 'edit-gesture': return f.isGm && f.editableSelected
    case 'dice': return !f.building
    case 'build-pickup': return f.isGm && !!f.building && !f.holding
    case 'build-turn': return f.isGm && !!f.building && !!f.holding && !!f.keyboard
    case 'build-putdown': return f.isGm && !!f.building && !!f.holding && !!f.keyboard
    case 'build-undo': return f.isGm && !!f.building && !!f.placed && !!f.keyboard
    case 'build-paste': return f.isGm && !!f.building && !!f.propSelected && !f.holding && !!f.keyboard
  }
}

/** The one tip to show now, or null. */
export function dueTip(f: TipFacts): TipId | null {
  if (f.busy) return null
  return TIP_ORDER.find((id) => !f.seen.has(id) && f.targets.has(id) && wanted(id, f)) ?? null
}

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

export interface Box { left: number; top: number; width: number; height: number }
export type Side = 'above' | 'below' | 'left'

export interface PlaceInput {
  /** The target (a zero-size box for a point). */
  anchor: Box
  /** Distance between the anchor and the bubble, arrow included. */
  gap: number
  /** Measured bubble size. */
  size: { width: number; height: number }
  viewport: { width: number; height: number }
  /** Safe-area insets plus the outer margin, per edge. */
  inset: { top: number; right: number; bottom: number; left: number }
  /** Preferred side; falls back to the others when it does not fit. */
  side: Side
  /** Areas the bubble must stay off (the bottom bar's buttons, the tab bar). */
  obstacles: readonly Box[]
}

export interface Placement {
  left: number
  top: number
  side: Side
  /** Arrow centre along the bubble's edge that faces the anchor (x for above/below, y for left). */
  arrow: number
}

const ARROW_MARGIN = 14

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function tryPlace(p: PlaceInput, side: Side): Placement | null {
  const { anchor: a, size, viewport: vp, inset, gap } = p
  const minX = inset.left, maxX = vp.width - inset.right - size.width
  const minY = inset.top, maxY = vp.height - inset.bottom - size.height
  if (maxX < minX || maxY < minY) return null
  const cx = a.left + a.width / 2, cy = a.top + a.height / 2
  let left: number, top: number
  if (side === 'left') {
    left = a.left - gap - size.width
    top = clamp(cy - size.height / 2, minY, maxY)
    if (left < minX) return null
  } else {
    left = clamp(cx - size.width / 2, minX, maxX)
    top = side === 'above' ? a.top - gap - size.height : a.top + a.height + gap
    if (top < minY || top > maxY) return null
  }
  // Slide upward off anything it must not cover; below the anchor there is nowhere to slide.
  for (let i = 0; i < p.obstacles.length + 1; i++) {
    const hit = p.obstacles.find((o) => overlaps({ left, top, width: size.width, height: size.height }, o))
    if (!hit) break
    if (side === 'below') return null
    top = hit.top - gap - size.height
    if (top < minY) return null
  }
  if (p.obstacles.some((o) => overlaps({ left, top, width: size.width, height: size.height }, o))) return null
  const arrow = side === 'left'
    ? clamp(cy - top, ARROW_MARGIN, size.height - ARROW_MARGIN)
    : clamp(cx - left, ARROW_MARGIN, size.width - ARROW_MARGIN)
  return { left, top, side, arrow }
}

const FALLBACK: Record<Side, Side[]> = { above: ['above', 'below', 'left'], below: ['below', 'above', 'left'], left: ['left', 'below', 'above'] }

/** Where the bubble goes, or null when it cannot fit without covering the target or a bar. */
export function placeBubble(p: PlaceInput): Placement | null {
  for (const side of FALLBACK[p.side]) {
    const placed = tryPlace(p, side)
    if (placed) return placed
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Storage (one flag per tip, like GmCallout)
// ---------------------------------------------------------------------------------------------

export const TIP_KEY_PREFIX = 'vtt.onboarding.tip.'

/** Tips retired on this device. Unreadable storage counts as all seen, so nothing nags. */
export function readSeenTips(): Set<TipId> {
  try {
    return new Set(TIP_ORDER.filter((id) => localStorage.getItem(TIP_KEY_PREFIX + id) === '1'))
  } catch {
    return new Set(TIP_ORDER)
  }
}

export function markTipSeen(id: TipId) {
  try { localStorage.setItem(TIP_KEY_PREFIX + id, '1') } catch { /* private mode, quota */ }
}
