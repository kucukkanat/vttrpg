import { describe, expect, it } from 'vitest'
import { PANELS } from '../panels/registry'
import { DESKTOP_DEFAULT } from './SideColumn'
import { LAYOUT_PRESETS, isDisplayPreset, isPresetId, presetBreakpoint, presetLayouts, presetsFor } from './layoutPresets'

describe('layout presets', () => {
  it('is a small fixed set, each with a label and a hint', () => {
    expect(LAYOUT_PRESETS.map((p) => p.id)).toEqual(['auto', 'gm', 'player', 'compact', 'display'])
    for (const p of LAYOUT_PRESETS) expect(p.label && p.hint).toBeTruthy()
  })

  it('offers the GM desk to GMs and the player desk to players', () => {
    expect(presetsFor(true).map((p) => p.id)).toEqual(['auto', 'gm', 'compact', 'display'])
    expect(presetsFor(false).map((p) => p.id)).toEqual(['auto', 'player', 'compact', 'display'])
  })

  it('desk presets fold only panels that exist, and keep chat open', () => {
    const ids = new Set(PANELS.map((p) => p.id))
    for (const id of ['gm', 'player'] as const) {
      const { desktop } = presetLayouts(id)
      expect(desktop).toBeDefined()
      for (const k of Object.keys(desktop!.collapsed)) expect(ids.has(k)).toBe(true)
      expect(desktop!.collapsed.chat).toBe(false)
    }
    expect(presetLayouts('player').desktop!.left.open).toBe(false)
    expect(presetLayouts('gm').desktop!.left.open).toBe(true)
  })

  it('standard restores the defaults; compact and display leave the columns alone', () => {
    expect(presetLayouts('auto').desktop).toEqual(DESKTOP_DEFAULT)
    expect(presetLayouts('compact')).toEqual({})
    expect(presetLayouts('display')).toEqual({})
  })

  it('compact renders the phone arrangement at any width; display is its own mode', () => {
    expect(presetBreakpoint('compact', 'desktop')).toBe('phone')
    expect(presetBreakpoint('gm', 'tablet')).toBe('tablet')
    expect(isDisplayPreset('display')).toBe(true)
    expect(isPresetId('display')).toBe(true)
    expect(isPresetId('nope')).toBe(false)
  })
})
