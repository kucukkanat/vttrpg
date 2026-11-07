/**
 * Appearance: the light/dark theme, the text-size preset and the pack theme hook. Everything is a
 * token swap on <html> (`data-theme`, `data-text-scale`, inline custom properties); global.css
 * holds the values.
 *
 * - Theme: "system" follows `prefers-color-scheme` (light → daylight), or "dark" / "daylight" by
 *   hand. Per device, in localStorage. The 3D table stays dark in both.
 * - Text size: default, large (×1.15) or larger (×1.3); every `--fs-*` size follows.
 * - Pack theme (`pack.json` "theme"): accent, display font and a frame tint, applied while a game
 *   of that pack is open. A pack may tint the chrome but not move it, and an accent that fails
 *   AA contrast on the current theme's panels is ignored rather than shipped unreadable.
 */
import { useEffect, useState } from 'react'
import type { PackTheme } from '@/core/pack'
import { contrastRatio, relativeLuminance } from './contrast'

export type ThemePref = 'system' | 'dark' | 'daylight'
export type TextScale = 'default' | 'large' | 'larger'
export type ResolvedTheme = 'dark' | 'daylight'

export const THEME_KEY = 'vtt.theme'
export const TEXT_SCALE_KEY = 'vtt.textScale'
const EVENT = 'vtt:appearance'
const LIGHT_QUERY = '(prefers-color-scheme: light)'
/** Page background per theme, for the browser's own chrome (`<meta name="theme-color">`). */
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0e0e10', daylight: '#f4f1ea' }
/** Panel colour per theme, which a pack accent must stay readable on. */
const PANEL: Record<ResolvedTheme, string> = { dark: '#17171b', daylight: '#fbfaf6' }

const THEMES: readonly ThemePref[] = ['system', 'dark', 'daylight']
const SCALES: readonly TextScale[] = ['default', 'large', 'larger']

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch { return fallback }
}
function write(key: string, value: string, fallback: string) {
  try {
    if (value === fallback) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* private mode, quota */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export const readThemePref = (): ThemePref => read(THEME_KEY, THEMES, 'system')
export const readTextScale = (): TextScale => read(TEXT_SCALE_KEY, SCALES, 'default')

const prefersLight = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches

export function resolveTheme(pref: ThemePref, systemLight: boolean): ResolvedTheme {
  if (pref === 'system') return systemLight ? 'daylight' : 'dark'
  return pref
}

/** Writes the current preferences onto <html>. */
export function applyAppearance(root: HTMLElement = document.documentElement): ResolvedTheme {
  const theme = resolveTheme(readThemePref(), prefersLight())
  root.dataset.theme = theme
  const scale = readTextScale()
  if (scale === 'default') delete root.dataset.textScale
  else root.dataset.textScale = scale
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  return theme
}

/** Applies the preferences now and keeps them current (system changes, other tabs, the settings). */
export function initAppearance(): void {
  applyAppearance()
  const on = () => applyAppearance()
  window.addEventListener(EVENT, on)
  window.addEventListener('storage', on)
  if (typeof window.matchMedia === 'function') window.matchMedia(LIGHT_QUERY).addEventListener('change', on)
}

export function setThemePref(pref: ThemePref): void { write(THEME_KEY, pref, 'system') }
export function setTextScale(scale: TextScale): void { write(TEXT_SCALE_KEY, scale, 'default') }

/** The stored preferences and the theme in effect, live. */
export function useAppearance(): { theme: ThemePref; resolved: ResolvedTheme; textScale: TextScale } {
  const get = () => ({ theme: readThemePref(), resolved: resolveTheme(readThemePref(), prefersLight()), textScale: readTextScale() })
  const [state, setState] = useState(get)
  useEffect(() => {
    const on = () => setState(get())
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', on)
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null
    mq?.addEventListener('change', on)
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); mq?.removeEventListener('change', on) }
  }, [])
  return state
}

/* ---------------------------------------------------------------------------------------------- */
/* Pack theme hook                                                                                 */

const HEX = /^#[0-9a-f]{6}$/i
const FAMILY = /^[a-z0-9][a-z0-9 _-]{0,47}$/i

/** The custom properties a pack theme sets for `theme`, after validation; unsafe or unreadable values are dropped. */
export function packThemeVars(t: PackTheme | undefined, theme: ResolvedTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!t) return vars
  if (typeof t.accent === 'string' && HEX.test(t.accent) && contrastRatio(t.accent, PANEL[theme]) >= 4.5) {
    vars['--accent'] = t.accent
    const fg = typeof t.accentFg === 'string' && HEX.test(t.accentFg) ? t.accentFg : relativeLuminance(t.accent) > 0.18 ? '#1a1612' : '#ffffff'
    if (contrastRatio(fg, t.accent) >= 4.5) vars['--accent-fg'] = fg
    else delete vars['--accent']
  }
  if (typeof t.frameTint === 'string' && HEX.test(t.frameTint)) vars['--frame-tint'] = `color-mix(in srgb, ${t.frameTint} ${theme === 'dark' ? 10 : 8}%, transparent)`
  const family = t.displayFont?.family
  if (typeof family === 'string' && FAMILY.test(family)) vars['--font-display'] = `"${family}", "Alegreya", Georgia, serif`
  return vars
}

const loadedFonts = new Set<string>()

/** Loads a pack's display face once (a same-origin or pack-relative URL resolved by the loader). */
function loadPackFont(t: PackTheme | undefined): void {
  const f = t?.displayFont
  if (!f?.src || typeof FontFace === 'undefined' || !FAMILY.test(f.family) || loadedFonts.has(f.src)) return
  if (!/^(\/|\.\/|https?:\/\/)/.test(f.src) || /^\s*javascript:/i.test(f.src)) return
  loadedFonts.add(f.src)
  const face = new FontFace(f.family, `url(${JSON.stringify(f.src)})`, { weight: f.weight ?? '700', display: 'swap' })
  face.load().then((loaded) => document.fonts.add(loaded), () => loadedFonts.delete(f.src!))
}

/** While mounted, applies the pack's theme on <html>; follows the light/dark switch. */
export function usePackTheme(t: PackTheme | undefined): void {
  const { resolved } = useAppearance()
  useEffect(() => {
    const root = document.documentElement
    const vars = packThemeVars(t, resolved)
    loadPackFont(t)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    return () => { for (const k of Object.keys(vars)) root.style.removeProperty(k) }
  }, [t, resolved])
}
