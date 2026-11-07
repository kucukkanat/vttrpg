import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  autoTier, frameDue, GRAPHICS_KEY, GRAPHICS_PRESETS, GRAPHICS_TIERS, isGraphicsSetting, readGraphicsSetting, resolveTier, setGraphicsSetting,
} from './graphics'

describe('autoTier', () => {
  it('saves power when the device asks for data saving', () => {
    expect(autoTier({ saveData: true, cores: 16 })).toBe('battery')
  })

  it('gives phones medium, or low when they are weak', () => {
    expect(autoTier({ coarse: true, memory: 8, cores: 8 })).toBe('medium')
    expect(autoTier({ coarse: true, memory: 2, cores: 8 })).toBe('low')
    expect(autoTier({ coarse: true, cores: 4 })).toBe('low')
    expect(autoTier({ coarse: true })).toBe('medium')
  })

  it('gives desktops high when they have the cores, medium otherwise', () => {
    expect(autoTier({ coarse: false, cores: 12, memory: 8 })).toBe('high')
    expect(autoTier({ coarse: false, cores: 6 })).toBe('medium')
    expect(autoTier({ coarse: false, cores: 4 })).toBe('medium')
    expect(autoTier({})).toBe('medium')
  })
})

describe('presets', () => {
  it('step down in cost from high to battery saver', () => {
    const order = GRAPHICS_TIERS.map((t) => GRAPHICS_PRESETS[t])
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.dpr[1]).toBeGreaterThanOrEqual(order[i - 1]!.dpr[1])
      expect(order[i]!.shadowCasters).toBeGreaterThanOrEqual(order[i - 1]!.shadowCasters)
    }
    expect(GRAPHICS_PRESETS.battery.shadows).toBe(false)
    expect(GRAPHICS_PRESETS.low.shadows).toBe(false)
    expect(GRAPHICS_PRESETS.battery.idleFps).toBeGreaterThan(0)
    expect(GRAPHICS_PRESETS.battery.activeFps).toBeGreaterThan(0)
  })

  it('keep post effects to the high tier', () => {
    for (const t of GRAPHICS_TIERS) {
      expect(GRAPHICS_PRESETS[t].glow).toBe(t === 'high')
      expect(GRAPHICS_PRESETS[t].selectionOutline).toBe(t === 'high')
    }
  })
})

describe('stored setting', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to auto and round-trips a tier', () => {
    expect(readGraphicsSetting()).toBe('auto')
    setGraphicsSetting('low')
    expect(store.get(GRAPHICS_KEY)).toBe('low')
    expect(readGraphicsSetting()).toBe('low')
    setGraphicsSetting('auto')
    expect(readGraphicsSetting()).toBe('auto')
  })

  it('falls back to auto when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(readGraphicsSetting()).toBe('auto')
  })

  it('ignores junk', () => {
    store.set(GRAPHICS_KEY, 'ultra')
    expect(readGraphicsSetting()).toBe('auto')
    expect(isGraphicsSetting('ultra')).toBe(false)
    expect(isGraphicsSetting('battery')).toBe(true)
    expect(resolveTier('high', { coarse: true, cores: 2 })).toBe('high')
    expect(resolveTier('auto', { coarse: true, cores: 2 })).toBe('low')
  })
})

describe('frameDue', () => {
  it('renders every frame when uncapped and paces otherwise', () => {
    expect(frameDue(1, 0, 0)).toBe(true)
    expect(frameDue(20, 0, 30)).toBe(false)
    expect(frameDue(32, 0, 30)).toBe(true)
    // A 60 Hz frame landing a touch early still counts for a 30 fps cap.
    expect(frameDue(1000 / 30 - 1, 0, 30)).toBe(true)
  })
})
