import { describe, expect, it } from 'vitest'
import { LAYOUT_PRESETS, isDisplayPreset, isPresetId, presetBreakpoint } from './layoutPresets'

describe('layout presets', () => {
  it('is a small fixed set, each with a label and a hint', () => {
    expect(LAYOUT_PRESETS.map((p) => p.id)).toEqual(['auto', 'compact', 'display'])
    for (const p of LAYOUT_PRESETS) expect(p.label && p.hint).toBeTruthy()
  })

  it('compact renders the phone arrangement at any width; display is its own mode', () => {
    expect(presetBreakpoint('compact', 'desktop')).toBe('phone')
    expect(presetBreakpoint('auto', 'tablet')).toBe('tablet')
    expect(isDisplayPreset('display')).toBe(true)
    expect(isPresetId('display')).toBe(true)
  })

  it('reads the retired column desks as unknown, so they fall back to Standard', () => {
    expect(isPresetId('gm')).toBe(false)
    expect(isPresetId('player')).toBe(false)
    expect(isPresetId('nope')).toBe(false)
  })
})
