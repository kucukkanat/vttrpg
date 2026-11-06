import { describe, expect, it } from 'vitest'
import { breakpointFor } from './useBreakpoint'
import { snapSheet } from './BottomSheet'
import { clampWidth, COL_MAX, COL_MIN } from './SideColumn'
import { keyboardInset } from './useKeyboardInset'
import { unreadCount } from './useUnread'

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
