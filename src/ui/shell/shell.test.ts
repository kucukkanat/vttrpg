import { describe, expect, it } from 'vitest'
import { breakpointFor } from './useBreakpoint'
import { snapSheet } from './BottomSheet'
import { clampWidth, COL_MAX, COL_MIN } from './SideColumn'
import { keyboardInset } from './useKeyboardInset'
import { unreadCount } from './useUnread'
import { MORE_ID, nextPhoneTab, splitPhoneTabs, sumBadges } from './phoneTabs'
import { edgeFade, scrollIntoRange } from './Drawer'
import type { PanelDef } from '../panels/registry'

describe('breakpoints', () => {
  it('splits phone / tablet / desktop at 700 and 1100', () => {
    expect(breakpointFor(375)).toBe('phone')
    expect(breakpointFor(699)).toBe('phone')
    expect(breakpointFor(700)).toBe('tablet')
    expect(breakpointFor(1024)).toBe('tablet')
    expect(breakpointFor(1099)).toBe('tablet')
    expect(breakpointFor(1100)).toBe('desktop')
  })
})

describe('bottom sheet snapping', () => {
  const half = 400, full = 720
  it('closes when dragged well below half', () => {
    expect(snapSheet({ height: 200, half, full, dx: 0, dy: 200 })).toEqual({ kind: 'close' })
  })
  it('returns to half for small drags', () => {
    expect(snapSheet({ height: 380, half, full, dx: 0, dy: 20 })).toEqual({ kind: 'size', size: 'half' })
    expect(snapSheet({ height: 500, half, full, dx: 0, dy: -100 })).toEqual({ kind: 'size', size: 'half' })
  })
  it('goes full past the midpoint between half and full', () => {
    expect(snapSheet({ height: 600, half, full, dx: 0, dy: -200 })).toEqual({ kind: 'size', size: 'full' })
  })
  it('switches tabs on a horizontal swipe', () => {
    expect(snapSheet({ height: half, half, full, dx: -90, dy: 5 })).toEqual({ kind: 'tab', dir: 1 })
    expect(snapSheet({ height: half, half, full, dx: 90, dy: -5 })).toEqual({ kind: 'tab', dir: -1 })
    expect(snapSheet({ height: half, half, full, dx: 90, dy: 80 }).kind).not.toBe('tab')
  })
})

describe('desktop columns', () => {
  it('clamps widths', () => {
    expect(clampWidth(10)).toBe(COL_MIN)
    expect(clampWidth(10_000)).toBe(COL_MAX)
    expect(clampWidth(300.4)).toBe(300)
  })
})

describe('keyboard inset', () => {
  it('is the part of the layout viewport hidden by the keyboard', () => {
    expect(keyboardInset(812, null)).toBe(0)
    expect(keyboardInset(812, { height: 812, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(812, { height: 500, offsetTop: 0 })).toBe(312)
    expect(keyboardInset(812, { height: 500, offsetTop: 100 })).toBe(212)
  })
})

describe('unread chat', () => {
  it('counts appended messages while closed and resets while open', () => {
    expect(unreadCount(10, 7, false)).toBe(3)
    expect(unreadCount(10, 7, true)).toBe(0)
    expect(unreadCount(5, 7, false)).toBe(0)
  })
})

describe('phone tabs', () => {
  const def = (id: string, phoneSlot?: number): PanelDef => ({ id, title: id, short: id, glyph: '', component: () => null, scope: 'all', side: 'left', phoneSlot })
  const panels = [def('scenes', 1), def('tokens', 2), def('object'), def('character', 3), def('chat', 4), def('journal'), def('prep')]
  const tabs = splitPhoneTabs(panels)

  it('puts slotted panels on the bar in slot order and the rest in More', () => {
    expect(tabs.primary.map((p) => p.id)).toEqual(['scenes', 'tokens', 'character', 'chat'])
    expect(tabs.more.map((p) => p.id)).toEqual(['object', 'journal', 'prep'])
  })
  it('orders by slot, not registry position', () => {
    const t = splitPhoneTabs([def('b', 2), def('a', 1)])
    expect(t.primary.map((p) => p.id)).toEqual(['a', 'b'])
    expect(t.more).toEqual([])
  })
  it('swipes around the primary ring with More at the end', () => {
    expect(nextPhoneTab('scenes', 1, tabs)).toBe('tokens')
    expect(nextPhoneTab('chat', 1, tabs)).toBe(MORE_ID)
    expect(nextPhoneTab(MORE_ID, 1, tabs)).toBe('scenes')
    expect(nextPhoneTab('scenes', -1, tabs)).toBe(MORE_ID)
  })
  it('swipes among the More panels when one of them is open', () => {
    expect(nextPhoneTab('object', 1, tabs)).toBe('journal')
    expect(nextPhoneTab('prep', 1, tabs)).toBe('object')
    expect(nextPhoneTab('object', -1, tabs)).toBe('prep')
  })
  it('skips More in the ring when nothing hides behind it', () => {
    const t = splitPhoneTabs([def('a', 1), def('b', 2)])
    expect(nextPhoneTab('b', 1, t)).toBe('a')
    expect(nextPhoneTab('zzz', 1, t)).toBe('zzz')
  })
  it('rolls hidden badges up onto More', () => {
    expect(sumBadges(tabs.more, { chat: 5, journal: 2, prep: 1 })).toBe(3)
    expect(sumBadges(tabs.more, {})).toBe(0)
  })
})

describe('drawer tab strip', () => {
  it('fades the edges that hide tabs', () => {
    expect(edgeFade(0, 360, 360)).toEqual({ start: false, end: false })
    expect(edgeFade(0, 360, 704)).toEqual({ start: false, end: true })
    expect(edgeFade(100, 360, 704)).toEqual({ start: true, end: true })
    expect(edgeFade(344, 360, 704)).toEqual({ start: true, end: false })
    expect(edgeFade(0.4, 360, 360.6)).toEqual({ start: false, end: false })
  })
  it('scrolls the active tab into view with padding', () => {
    expect(scrollIntoRange(0, 360, 64, 128, 12)).toBe(0)
    expect(scrollIntoRange(0, 360, 640, 704, 12)).toBe(356)
    expect(scrollIntoRange(356, 360, 0, 64, 12)).toBe(0)
    expect(scrollIntoRange(200, 360, 240, 300, 12)).toBe(200)
    expect(scrollIntoRange(300, 360, 300, 364, 12)).toBe(288)
  })
})
