import { describe, expect, it } from 'vitest'
import { COLOR_NAMES, colorName, parseHex } from './colorName'

describe('colorName', () => {
  it('names every palette colour exactly', () => {
    for (const [hex, name] of Object.entries(COLOR_NAMES)) expect(colorName(hex)).toBe(name)
  })
  it('is case and whitespace insensitive', () => {
    expect(colorName(' #E0A458 ')).toBe('Amber')
  })
  it('falls back to the nearest hue for unknown colours', () => {
    expect(colorName('#ff0000')).toBe('Red')
    expect(colorName('#0000ff')).toBe('Blue')
    expect(colorName('#00ff00')).toBe('Green')
    expect(colorName('#f80')).toBe('Orange')
  })
  it('handles greys, black and white', () => {
    expect(colorName('#000')).toBe('Black')
    expect(colorName('#ffffff')).toBe('White')
    expect(colorName('#808080')).toBe('Grey')
    expect(colorName('#333333')).toBe('Dark grey')
    expect(colorName('#cccccc')).toBe('Light grey')
  })
  it('qualifies very dark and very pale hues', () => {
    expect(colorName('#400000')).toBe('Dark red')
    expect(colorName('#ffd0d0')).toBe('Pale red')
  })
  it('returns non-hex input unchanged', () => {
    expect(colorName('var(--accent)')).toBe('var(--accent)')
    expect(parseHex('red')).toBeNull()
  })
})
