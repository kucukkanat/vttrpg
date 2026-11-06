/**
 * Human-readable names for the colours used on swatches, token dots and presence, so screen readers
 * announce "Amber" rather than "#e0a458". Known palette entries map exactly; anything else gets the
 * nearest basic hue by HSL so new colours still read sensibly.
 */

/** Palette colours (tokens, encounters, presence) with their spoken names. */
export const COLOR_NAMES: Record<string, string> = {
  '#e0a458': 'Amber',
  '#7cc4ff': 'Sky blue',
  '#8fd18f': 'Mint green',
  '#f28b82': 'Coral',
  '#c58af9': 'Lavender',
  '#ffd166': 'Gold',
  '#9aa0a6': 'Grey',
  '#d98f3e': 'Orange',
  '#9fd356': 'Lime',
  '#b8a98a': 'Tan',
  '#6c7a8a': 'Slate',
  '#4b4f5a': 'Charcoal',
}

interface Hsl { h: number; s: number; l: number }

/** Parses `#rgb` or `#rrggbb`; null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let s = m[1]
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHsl([r, g, b]: [number, number, number]): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h = (h * 60 + 360) % 360
  return { h, s, l }
}

const HUES: [number, string][] = [
  [0, 'Red'], [20, 'Orange'], [45, 'Amber'], [60, 'Yellow'], [80, 'Lime'], [120, 'Green'],
  [165, 'Teal'], [185, 'Cyan'], [225, 'Blue'], [262, 'Indigo'], [282, 'Purple'], [305, 'Magenta'], [335, 'Pink'], [360, 'Red'],
]

function hueName(h: number): string {
  let best = HUES[0]
  for (const entry of HUES) if (Math.abs(entry[0] - h) < Math.abs(best[0] - h)) best = entry
  return best[1]
}

/** Spoken name for a CSS hex colour; falls back to the colour string itself when it is not hex. */
export function colorName(color: string): string {
  const key = color.trim().toLowerCase()
  const known = COLOR_NAMES[key]
  if (known) return known
  const rgb = parseHex(key)
  if (!rgb) return color
  const { h, s, l } = toHsl(rgb)
  if (l < 0.12) return 'Black'
  if (l > 0.93) return 'White'
  if (s < 0.12) return l < 0.35 ? 'Dark grey' : l > 0.7 ? 'Light grey' : 'Grey'
  const base = hueName(h)
  if (l < 0.3) return `Dark ${base.toLowerCase()}`
  if (l > 0.78) return `Pale ${base.toLowerCase()}`
  return base
}
