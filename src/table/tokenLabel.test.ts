import { describe, expect, it } from 'vitest'
import { initialsOf, inkOn, LOCAL_OWNER_COLOR, nameplateShown, OFFLINE_OWNER_COLOR, ownerRingColor } from './tokenLabel'

describe('initialsOf', () => {
  it('takes two letters of one word, or the first and last initials', () => {
    expect(initialsOf('Pip')).toBe('PI')
    expect(initialsOf('old rat king')).toBe('OK')
    expect(initialsOf('  ')).toBe('?')
  })
})

describe('inkOn', () => {
  it('writes dark on light tokens and light on dark ones', () => {
    expect(inkOn('#ffffff')).toBe('#1a1612')
    expect(inkOn('#fff')).toBe('#1a1612')
    expect(inkOn('#202040')).toBe('#f6efe3')
    expect(inkOn('not a colour')).toBe('#f6efe3')
  })
})

describe('ownerRingColor', () => {
  it('keeps no ring for unowned and GM-owned tokens', () => {
    expect(ownerRingColor(undefined, 'gm', 'me', '#f00')).toBeNull()
    expect(ownerRingColor('gm', 'gm', 'me', '#f00')).toBeNull()
  })
  it("uses the owner's presence colour, with fallbacks when they have none", () => {
    expect(ownerRingColor('alice', 'gm', 'me', '#ff0000')).toBe('#ff0000')
    expect(ownerRingColor('me', 'gm', 'me', undefined)).toBe(LOCAL_OWNER_COLOR)
    expect(ownerRingColor('alice', 'gm', 'me', undefined)).toBe(OFFLINE_OWNER_COLOR)
  })
})

describe('nameplateShown', () => {
  it('shows for own, selected, hovered and current tokens only', () => {
    const none = { mine: false, selected: false, hovered: false, current: false }
    expect(nameplateShown(none)).toBe(false)
    for (const k of ['mine', 'selected', 'hovered', 'current'] as const) expect(nameplateShown({ ...none, [k]: true })).toBe(true)
  })
})
