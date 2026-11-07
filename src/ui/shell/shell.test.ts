import { describe, expect, it } from 'vitest'
import { breakpointFor } from './useBreakpoint'
import { snapSheet } from './BottomSheet'
import { clampWidth, COL_MAX, COL_MIN, DEFAULT_COLLAPSED, DESKTOP_DEFAULT, DESKTOP_LAYOUT_VERSION, KEY_STEP, keyResize, migrateDesktopLayout } from './SideColumn'
import { loadPersisted } from './usePersisted'
import { keyboardInset } from './useKeyboardInset'
import { unreadCount, unreadNoteCount } from './useUnread'
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
  it('starts with the authoring, reference and occasional sections folded', () => {
    expect(DESKTOP_DEFAULT.collapsed).toEqual({ 'skills-editor': true, prep: true, journal: true, sound: true, players: true })
    expect(DESKTOP_DEFAULT.collapsed.chat).toBeUndefined()
    expect(DESKTOP_DEFAULT.version).toBe(DESKTOP_LAYOUT_VERSION)
  })
  it('resizes by 16 px per arrow key toward the table, clamped', () => {
    expect(keyResize('left', 'ArrowRight', 260)).toBe(260 + KEY_STEP)
    expect(keyResize('left', 'ArrowLeft', 260)).toBe(260 - KEY_STEP)
    expect(keyResize('right', 'ArrowLeft', 340)).toBe(340 + KEY_STEP)
    expect(keyResize('right', 'ArrowRight', 340)).toBe(340 - KEY_STEP)
    expect(keyResize('left', 'ArrowLeft', COL_MIN)).toBe(COL_MIN)
    expect(keyResize('right', 'ArrowLeft', COL_MAX)).toBe(COL_MAX)
    expect(keyResize('left', 'Home', 300)).toBe(COL_MIN)
    expect(keyResize('left', 'End', 300)).toBe(COL_MAX)
    expect(keyResize('left', 'ArrowUp', 300)).toBeNull()
    expect(keyResize('left', 'a', 300)).toBeNull()
  })
})

describe('desktop layout migration', () => {
  const options = { version: DESKTOP_LAYOUT_VERSION, migrate: migrateDesktopLayout }

  it('gives a fresh browser the defaults', () => {
    expect(loadPersisted(null, DESKTOP_DEFAULT, options)).toEqual(DESKTOP_DEFAULT)
    expect(loadPersisted('not json', DESKTOP_DEFAULT, options)).toEqual(DESKTOP_DEFAULT)
  })

  it('folds the new defaults for a version-0 layout the user never touched', () => {
    const raw = JSON.stringify({ left: { width: 300, open: true }, right: { width: 340, open: false }, collapsed: {} })
    const out = loadPersisted(raw, DESKTOP_DEFAULT, options)
    expect(out.version).toBe(DESKTOP_LAYOUT_VERSION)
    expect(out.left).toEqual({ width: 300, open: true })
    expect(out.right).toEqual({ width: 340, open: false })
    expect(out.collapsed).toEqual(DEFAULT_COLLAPSED)
  })

  it('keeps the sections a version-0 user toggled, in either direction', () => {
    const raw = JSON.stringify({ left: { width: 260, open: true }, right: { width: 340, open: true }, collapsed: { journal: false, skills: true, chat: false } })
    const out = loadPersisted(raw, DESKTOP_DEFAULT, options)
    expect(out.collapsed).toEqual({ 'skills-editor': true, prep: true, journal: false, skills: true, chat: false, sound: true, players: true })
  })

  it('folds the sections new in version 2 for a version-1 layout, unless the user set them', () => {
    const raw = JSON.stringify({ version: 1, left: { width: 260, open: true }, right: { width: 340, open: true }, collapsed: { journal: true, players: false } })
    const out = loadPersisted(raw, DESKTOP_DEFAULT, options)
    expect(out.collapsed).toEqual({ journal: true, players: false, sound: true })
  })

  it('survives a version-0 object with no collapsed map', () => {
    const out = loadPersisted(JSON.stringify({ left: { width: 220, open: true } }), DESKTOP_DEFAULT, options)
    expect(out.collapsed).toEqual(DEFAULT_COLLAPSED)
    expect(out.right).toEqual(DESKTOP_DEFAULT.right)
    expect(out.left.width).toBe(220)
  })

  it('reads a current-version layout as stored, without re-applying defaults', () => {
    const stored = { version: DESKTOP_LAYOUT_VERSION, left: { width: 200, open: true }, right: { width: 480, open: true }, collapsed: { prep: false } }
    const out = loadPersisted(JSON.stringify(stored), DESKTOP_DEFAULT, options)
    expect(out).toEqual(stored)
  })

  it('runs the migration only when the version differs', () => {
    let calls = 0
    type Probe = { version: number; a: number }
    const probe = { version: 2, migrate: (s: Record<string, unknown>): Probe => { calls++; return { version: 2, a: Number(s.a) } } }
    loadPersisted(JSON.stringify({ version: 2, a: 1 }), { version: 2, a: 0 }, probe)
    expect(calls).toBe(0)
    expect(loadPersisted(JSON.stringify({ version: 1, a: 1 }), { version: 2, a: 0 }, probe)).toEqual({ version: 2, a: 1 })
    expect(calls).toBe(1)
  })

  it('still shallow-merges stored objects over defaults without options', () => {
    expect(loadPersisted(JSON.stringify({ tab: 'chat' }), { tab: 'x', open: true, pinned: true })).toEqual({ tab: 'chat', open: true, pinned: true })
    expect(loadPersisted('[1,2]', [0])).toEqual([1, 2])
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

describe('unread notes', () => {
  const seen = new Set(['a', 'b'])
  it('counts notes that appeared while the panel was hidden', () => {
    expect(unreadNoteCount(['a', 'b'], seen, false)).toBe(0)
    expect(unreadNoteCount(['a', 'b', 'c', 'd'], seen, false)).toBe(2)
  })
  it('ignores notes that went away and is zero while the panel is open', () => {
    expect(unreadNoteCount(['a'], seen, false)).toBe(0)
    expect(unreadNoteCount(['a', 'b', 'c'], seen, true)).toBe(0)
  })
})
