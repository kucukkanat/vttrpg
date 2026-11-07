import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HAPTIC_PATTERNS, haptic, hapticsSupported } from './haptics'
import { PREF_KEYS, readPref, setPref } from './prefs'
import { pressTarget, PRESSABLE } from './press'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

describe('feel preferences', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('window', { dispatchEvent: () => true })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('default to on and remember being switched off', () => {
    expect(readPref('haptics')).toBe(true)
    setPref('haptics', false)
    expect(localStorage.getItem(PREF_KEYS.haptics)).toBe('0')
    expect(readPref('haptics')).toBe(false)
    expect(readPref('turnCue')).toBe(true)
    setPref('haptics', true)
    expect(localStorage.getItem(PREF_KEYS.haptics)).toBeNull()
    expect(readPref('haptics')).toBe(true)
  })
  it('fall back to on when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(readPref('twoTapMove')).toBe(true)
  })
})

describe('haptic', () => {
  it('vibrates with the pattern for the kind when supported and enabled', () => {
    const vibrate = vi.fn(() => true)
    expect(haptic('commit', { vibrate }, true)).toBe(true)
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.commit)
  })
  it('is a no-op when switched off or unsupported (iOS Safari, desktops)', () => {
    const vibrate = vi.fn(() => true)
    expect(haptic('press', { vibrate }, false)).toBe(false)
    expect(vibrate).not.toHaveBeenCalled()
    expect(haptic('press', {}, true)).toBe(false)
    expect(haptic('press', undefined, true)).toBe(false)
    expect(hapticsSupported({})).toBe(false)
    expect(hapticsSupported({ vibrate })).toBe(true)
  })
  it('swallows a throwing vibrate', () => {
    expect(haptic('turn', { vibrate: () => { throw new Error('blocked') } }, true)).toBe(false)
  })
  it('keeps every pattern short', () => {
    for (const p of Object.values(HAPTIC_PATTERNS)) {
      const total = Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p
      expect(total).toBeLessThanOrEqual(300)
    }
  })
})

describe('pressTarget', () => {
  const el = (attrs: Record<string, string> = {}, disabled = false) => ({ disabled, getAttribute: (k: string) => attrs[k] ?? null })
  it('finds the closest pressable control', () => {
    const button = el()
    const target = { closest: (sel: string) => (sel === PRESSABLE ? button : null) }
    expect(pressTarget(target)).toBe(button)
  })
  it('ignores disabled controls, plain elements and non-elements', () => {
    expect(pressTarget({ closest: () => el({}, true) })).toBeNull()
    expect(pressTarget({ closest: () => el({ 'aria-disabled': 'true' }) })).toBeNull()
    expect(pressTarget({ closest: () => null })).toBeNull()
    expect(pressTarget(null)).toBeNull()
    expect(pressTarget({})).toBeNull()
  })
})
