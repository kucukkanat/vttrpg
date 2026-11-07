/**
 * Graphics quality presets: battery saver, low, medium, high. One per device, in localStorage
 * (`vtt.graphics`), defaulting to `auto`, which picks a tier from what the browser says about the
 * device. Every tier keeps the same look (toon bands, outlines, blob shadows, fog): the lower ones
 * drop resolution, real-time shadows, antialiasing and frame rate, the high tier adds an outline
 * on the selected token and a glow around flames.
 *
 * No three.js here: the settings UI imports this through the `@/table` barrel.
 */
import { useEffect, useState } from 'react'

export type GraphicsTier = 'battery' | 'low' | 'medium' | 'high'
export type GraphicsSetting = GraphicsTier | 'auto'

export interface GraphicsPreset {
  tier: GraphicsTier
  /** Device-pixel-ratio range handed to the canvas. */
  dpr: [number, number]
  /** MSAA; changing it remounts the canvas. */
  antialias: boolean
  /**
   * Real-time shadow maps from scene lights. Blob shadows under tokens are always on. PCF only:
   * three's point-light shadows are compiled out for the soft and VSM map types.
   */
  shadows: false | 'percentage'
  /** Scene lights that may cast shadows, and their map size. */
  shadowCasters: number
  shadowMapSize: number
  /** Frames per second while nothing moves; 0 renders every frame. */
  idleFps: number
  /** Frames per second while the player interacts or the table changes; 0 renders every frame. */
  activeFps: number
  /** Thick hull in the selection colour around the selected token. */
  selectionOutline: boolean
  /** Additive halo sprites on emissive meshes (flames, embers, orbs). */
  glow: boolean
  /** Imported GLBs keep PBR on medium and high; the lower tiers switch them to Lambert. */
  pbr: boolean
}

export const GRAPHICS_PRESETS: Record<GraphicsTier, GraphicsPreset> = {
  battery: {
    tier: 'battery', dpr: [1, 1], antialias: false, shadows: false, shadowCasters: 0, shadowMapSize: 512,
    idleFps: 12, activeFps: 30, selectionOutline: false, glow: false, pbr: false,
  },
  low: {
    tier: 'low', dpr: [1, 1], antialias: false, shadows: false, shadowCasters: 0, shadowMapSize: 512,
    idleFps: 24, activeFps: 0, selectionOutline: false, glow: false, pbr: false,
  },
  medium: {
    tier: 'medium', dpr: [1, 1.5], antialias: true, shadows: 'percentage', shadowCasters: 2, shadowMapSize: 512,
    idleFps: 30, activeFps: 0, selectionOutline: false, glow: false, pbr: true,
  },
  high: {
    tier: 'high', dpr: [1, 2], antialias: true, shadows: 'percentage', shadowCasters: 4, shadowMapSize: 1024,
    idleFps: 0, activeFps: 0, selectionOutline: true, glow: true, pbr: true,
  },
}

export const GRAPHICS_TIERS: readonly GraphicsTier[] = ['battery', 'low', 'medium', 'high']
export const GRAPHICS_LABELS: Record<GraphicsTier, string> = { battery: 'Battery saver', low: 'Low', medium: 'Medium', high: 'High' }

/** What the browser tells us about the device; every field may be missing. */
export interface DeviceHints {
  /** Primary pointer is coarse (a phone or tablet). */
  coarse?: boolean
  /** `navigator.deviceMemory` in GB (Chromium only, capped at 8). */
  memory?: number
  /** `navigator.hardwareConcurrency`. */
  cores?: number
  /** Data saver on (`navigator.connection.saveData`), taken as a hint to save power too. */
  saveData?: boolean
}

/**
 * Default tier for a device. Phones get medium, or low when they report little memory or few
 * cores; desktops get high when they have the cores for it. Unknown values count as mid-range.
 */
export function autoTier(h: DeviceHints): GraphicsTier {
  if (h.saveData) return 'battery'
  const weak = (h.memory !== undefined && h.memory <= 3) || (h.cores !== undefined && h.cores <= 4)
  if (h.coarse) return weak ? 'low' : 'medium'
  if (weak) return 'medium'
  return h.cores !== undefined && h.cores >= 8 ? 'high' : 'medium'
}

export function readDeviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return { coarse, memory: nav.deviceMemory, cores: nav.hardwareConcurrency || undefined, saveData: nav.connection?.saveData }
}

export function resolveTier(setting: GraphicsSetting, hints: DeviceHints = readDeviceHints()): GraphicsTier {
  return setting === 'auto' ? autoTier(hints) : setting
}

export const GRAPHICS_KEY = 'vtt.graphics'
const EVENT = 'vtt:graphics'

export function isGraphicsSetting(v: unknown): v is GraphicsSetting {
  return v === 'auto' || (typeof v === 'string' && (GRAPHICS_TIERS as readonly string[]).includes(v))
}

export function readGraphicsSetting(): GraphicsSetting {
  try {
    const v = localStorage.getItem(GRAPHICS_KEY)
    return isGraphicsSetting(v) ? v : 'auto'
  } catch { return 'auto' }
}

export function setGraphicsSetting(setting: GraphicsSetting): void {
  try {
    if (setting === 'auto') localStorage.removeItem(GRAPHICS_KEY)
    else localStorage.setItem(GRAPHICS_KEY, setting)
  } catch { /* private mode, quota */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/** The stored setting, live across components and tabs. */
export function useGraphicsSetting(): GraphicsSetting {
  const [setting, setSetting] = useState(readGraphicsSetting)
  useEffect(() => {
    const on = () => setSetting(readGraphicsSetting())
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
  }, [])
  return setting
}

/** The preset in effect on this device. */
export function useGraphics(): GraphicsPreset {
  const setting = useGraphicsSetting()
  return GRAPHICS_PRESETS[resolveTier(setting)]
}

/**
 * Frame pacing: whether a frame is due at `now` (ms) given the last rendered frame and the target
 * rate. A small slack keeps a 60 Hz display from skipping every other frame at a 30 fps cap.
 */
export function frameDue(now: number, last: number, fps: number): boolean {
  if (fps <= 0) return true
  return now - last >= 1000 / fps - 2
}
