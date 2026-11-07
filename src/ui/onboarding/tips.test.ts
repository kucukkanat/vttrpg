import { afterEach, describe, expect, it, vi } from 'vitest'
import { dueTip, markTipSeen, placeBubble, readSeenTips, TIP_KEY_PREFIX, TIP_ORDER, type PlaceInput, type TipFacts, type TipId } from './tips'

const all = new Set<TipId>(TIP_ORDER)
function facts(p: Partial<TipFacts> = {}): TipFacts {
  return { isGm: false, ownsToken: false, tokenSelected: false, editableSelected: false, myTurn: false, busy: false, targets: all, seen: new Set(), ...p }
}

describe('dueTip', () => {
  it('shows the dice tip to anyone once the button is on screen', () => {
    expect(dueTip(facts())).toBe('dice')
    expect(dueTip(facts({ isGm: true }))).toBe('dice')
    expect(dueTip(facts({ targets: new Set() }))).toBeNull()
  })

  it('teaches a token owner the bar first, then the rest', () => {
    expect(dueTip(facts({ ownsToken: true }))).toBe('token-bar')
    expect(dueTip(facts({ ownsToken: true, seen: new Set(['token-bar']) }))).toBe('dice')
  })

  it('never shows the token bar tip to the GM or a player without a token', () => {
    expect(dueTip(facts({ isGm: true, ownsToken: true, seen: new Set(['dice']) }))).toBeNull()
    expect(dueTip(facts({ seen: new Set(['dice']) }))).toBeNull()
  })

  it('puts your turn ahead of everything for a player', () => {
    expect(dueTip(facts({ ownsToken: true, myTurn: true, tokenSelected: true }))).toBe('your-turn')
    expect(dueTip(facts({ isGm: true, myTurn: true, seen: new Set(['dice']) }))).toBeNull()
  })

  it('shows long-press on a selection, then the edit gesture for the GM only', () => {
    expect(dueTip(facts({ tokenSelected: true, editableSelected: true }))).toBe('long-press')
    const seen = new Set<TipId>(['long-press', 'dice'])
    expect(dueTip(facts({ tokenSelected: true, editableSelected: true, seen }))).toBeNull()
    expect(dueTip(facts({ isGm: true, tokenSelected: true, editableSelected: true, seen }))).toBe('edit-gesture')
    // A prop alone: no long-press (tokens only), but the GM's edit gesture applies.
    expect(dueTip(facts({ isGm: true, editableSelected: true, seen: new Set(['dice']) }))).toBe('edit-gesture')
  })

  it('waits for the target and stays quiet while busy', () => {
    expect(dueTip(facts({ ownsToken: true, targets: new Set(['dice']) }))).toBe('dice')
    expect(dueTip(facts({ ownsToken: true, busy: true }))).toBeNull()
  })

  it('shows nothing once everything is seen', () => {
    expect(dueTip(facts({ isGm: true, ownsToken: true, myTurn: true, tokenSelected: true, editableSelected: true, seen: all }))).toBeNull()
  })
})

describe('placeBubble', () => {
  const base: PlaceInput = {
    anchor: { left: 100, top: 500, width: 200, height: 50 },
    gap: 10, size: { width: 160, height: 60 },
    viewport: { width: 400, height: 700 },
    inset: { top: 8, right: 8, bottom: 8, left: 8 },
    side: 'above', obstacles: [],
  }

  it('sits above the anchor, centred, with the arrow on the anchor', () => {
    expect(placeBubble(base)).toEqual({ left: 120, top: 430, side: 'above', arrow: 80 })
  })

  it('clamps to the viewport and keeps the arrow pointing at the anchor', () => {
    const p = placeBubble({ ...base, anchor: { left: 0, top: 500, width: 20, height: 20 } })!
    expect(p.left).toBe(8)
    expect(p.arrow).toBe(14)
  })

  it('flips below when there is no room above', () => {
    const p = placeBubble({ ...base, anchor: { left: 100, top: 30, width: 200, height: 20 } })!
    expect(p.side).toBe('below')
    expect(p.top).toBe(60)
  })

  it('goes left of a rail button, falling back below at the edge', () => {
    const rail = { left: 340, top: 60, width: 44, height: 44 }
    expect(placeBubble({ ...base, side: 'left', anchor: rail })).toMatchObject({ side: 'left', left: 170 })
    expect(placeBubble({ ...base, side: 'left', anchor: { ...rail, left: 100 } })!.side).toBe('below')
  })

  it('slides up off the bottom bar instead of covering it', () => {
    const bar = { left: 0, top: 400, width: 400, height: 80 }
    const p = placeBubble({ ...base, obstacles: [bar] })!
    expect(p.top + 60).toBeLessThanOrEqual(400)
  })

  it('gives up when the viewport is too small', () => {
    expect(placeBubble({ ...base, viewport: { width: 100, height: 50 } })).toBeNull()
  })
})

describe('tip storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remembers retired tips per device', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    expect(readSeenTips().size).toBe(0)
    markTipSeen('dice')
    expect(store.get(TIP_KEY_PREFIX + 'dice')).toBe('1')
    expect([...readSeenTips()]).toEqual(['dice'])
  })

  it('treats unreadable storage as all seen', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(readSeenTips().size).toBe(TIP_ORDER.length)
    expect(() => markTipSeen('dice')).not.toThrow()
  })
})
