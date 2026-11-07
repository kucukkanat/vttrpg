import { describe, expect, it } from 'vitest'
import { guardManifest } from '@/rules/load'
import { packThemeVars, resolveTheme } from './theme'

describe('theme', () => {
  it('follows the system setting unless chosen by hand', () => {
    expect(resolveTheme('system', true)).toBe('daylight')
    expect(resolveTheme('system', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('daylight', false)).toBe('daylight')
  })
})

describe('pack theme hook', () => {
  it('applies a readable accent, a frame tint and a display face', () => {
    const vars = packThemeVars({ accent: '#7fb2ff', frameTint: '#6a3cff', displayFont: { family: 'Cinzel Decorative' } }, 'dark')
    expect(vars['--accent']).toBe('#7fb2ff')
    expect(vars['--accent-fg']).toBe('#1a1612')
    expect(vars['--frame-tint']).toBe('color-mix(in srgb, #6a3cff 10%, transparent)')
    expect(vars['--font-display']).toBe('"Cinzel Decorative", "Alegreya", Georgia, serif')
  })
  it('drops an accent that fails AA on the current theme, and anything that is not a plain value', () => {
    // A pale accent reads on dark panels but not on daylight ones.
    expect(packThemeVars({ accent: '#ffd27a' }, 'dark')['--accent']).toBe('#ffd27a')
    expect(packThemeVars({ accent: '#ffd27a' }, 'daylight')['--accent']).toBeUndefined()
    expect(packThemeVars({ accent: 'red; background: url(x)' }, 'dark')).toEqual({})
    expect(packThemeVars({ displayFont: { family: 'x"; } body { color: red' } }, 'dark')).toEqual({})
    expect(packThemeVars(undefined, 'dark')).toEqual({})
  })
  it('is checked when the pack loads', () => {
    const base = { id: 'p', name: 'P', version: '1', grid: { type: 'square', cellSize: 1.5 }, files: { attributes: 'a', resources: 'r', conditions: 'c', sheet: 's' } }
    expect(guardManifest({ ...base, theme: { accent: '#112233', displayFont: { family: 'Fell', src: 'fonts/fell.woff2' } } }).theme?.accent).toBe('#112233')
    expect(() => guardManifest({ ...base, theme: { accent: 'blue' } })).toThrow(/theme/)
  })
})
