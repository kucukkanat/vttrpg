/**
 * Monochrome glyphs as SVG path data on the shared 24-unit icon grid, so one drawing serves the
 * DOM (an <svg> with these paths) and the 3D table (a canvas `Path2D` built from the same strings).
 * Stroked with `ICON_STROKE`, round caps and joins; a zero-length segment ("h.01") draws a dot.
 *
 * - Status glyphs are keyed by the icon names packs already use on conditions (`ConditionDef.icon`).
 * - HP and dice backups: `bloodied` (a drop, at half HP or less), `skull` (at zero), `crit` (a star,
 *   natural max), `fumble` (a broken ring, natural 1).
 * - Status frames: one border shape per category (see `statusLook`).
 *
 * No React, no three.js; `drawGlyph` needs a canvas 2D context and runs in the browser only.
 */

import { CONDITION_CATEGORIES, type ConditionCategory } from '@/core/pack'

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`

export const GLYPHS: Record<string, readonly string[]> = {
  // HP and dice
  bloodied: ['M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11z', 'M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5'],
  skull: ['M5 11a7 7 0 0 1 14 0c0 2.3-1 3.8-2.5 4.8V19h-9v-3.2C6 14.8 5 13.3 5 11z', circle(9.3, 11.5, 1.6), circle(14.7, 11.5, 1.6), 'M10.5 19v2M13.5 19v2'],
  crit: ['M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7L12 3z'],
  fumble: ['M10 3.7A8.5 8.5 0 0 0 5.3 17.2M7.6 19.3A8.5 8.5 0 0 0 20.3 13.5M20.2 10A8.5 8.5 0 0 0 13.5 3.6', 'M9.5 9.5l5 5M14.5 9.5l-5 5'],
  // statuses (pack icon names)
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', circle(12, 12, 3)],
  'eye-off': ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', circle(12, 12, 3), 'M4 4l16 16'],
  heart: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'],
  'ear-off': ['M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6', 'M10 9.5a2 2 0 0 1 4 0', 'M4 4l16 16'],
  zzz: ['M4 5h5l-5 6h5', 'M12 10h4l-4 5h4', 'M16.5 16.5h3.5l-3.5 4h3.5'],
  ghost: ['M6 20.5V10a6 6 0 0 1 12 0v10.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z', 'M9.5 10.5h.01M14.5 10.5h.01'],
  hand: ['M8 13V6a1.5 1.5 0 0 1 3 0v5', 'M11 11V4.5a1.5 1.5 0 0 1 3 0V11', 'M14 11V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5A5.5 5.5 0 0 1 5 17.5L3.6 14a1.5 1.5 0 0 1 2.6-1.4L8 15'],
  ban: [circle(12, 12, 8.5), 'M6 6l12 12'],
  snowflake: ['M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5', 'M9.5 4 12 6.5 14.5 4M9.5 20l2.5-2.5 2.5 2.5'],
  mountain: ['M2.5 20 9 8l4 7 2.5-4 6 9z'],
  'arrow-down': ['M12 4v15', 'M6 13l6 6 6-6'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5'],
  stars: ['M3 17c0-1.7 4-3 9-3s9 1.3 9 3-4 3-9 3-9-1.3-9-3z', 'M12 3l1.3 2.8 3 .4-2.2 2 .6 3-2.7-1.5-2.7 1.5.6-3-2.2-2 3-.4L12 3z'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  shield: ['M12 21.5s8-3.5 8-10V5l-8-3-8 3v6.5c0 6.5 8 10 8 10z'],
  bowl: ['M3 11h18a9 9 0 0 1-18 0z', 'M8 20.5h8', 'M9 7.5c0-1.5 1-1.5 1-3M13.5 7.5c0-1.5 1-1.5 1-3'],
  bandage: ['M4.6 14.6 14.6 4.6a3 3 0 0 1 4.2 0l.6.6a3 3 0 0 1 0 4.2L9.4 19.4a3 3 0 0 1-4.2 0l-.6-.6a3 3 0 0 1 0-4.2z', 'M11 11h.01M13 13h.01M11 13h.01M13 11h.01'],
  flame: ['M12 22c4 0 7-2.7 7-6.8 0-3.6-2.4-6-4.2-8.2-.4 2-1.3 3.3-2.8 4C12.6 7.5 11 4.4 8.5 2c.3 3.4-1.6 5.6-3 7.6A9 9 0 0 0 5 15.2C5 19.3 8 22 12 22z'],
  brain: ['M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6 17a3 3 0 0 0 3.5 3 2.5 2.5 0 0 0 2.5-2.5V6.5A2.5 2.5 0 0 0 9.5 4z', 'M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 18 17a3 3 0 0 1-3.5 3 2.5 2.5 0 0 1-2.5-2.5'],
  spark: ['M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z'],
}

/** The pack's condition categories (one scheme, defined with `ConditionDef`). */
export type StatusCategory = ConditionCategory
export type StatusShape = 'circle' | 'hexagon' | 'square' | 'shield' | 'diamond'

export const STATUS_CATEGORIES: readonly StatusCategory[] = CONDITION_CATEGORIES

/** Border shape per category, so the kind reads without its colour (round buff, square control, …). */
export const CATEGORY_SHAPE: Record<StatusCategory, StatusShape> = {
  buff: 'circle',
  harm: 'hexagon',
  control: 'square',
  magic: 'shield',
  affliction: 'diamond',
}

/** Frame outlines on the 24 grid, filled behind the glyph and stroked in the category colour. */
export const SHAPES: Record<StatusShape, string> = {
  circle: circle(12, 12, 10.5),
  hexagon: 'M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z',
  square: 'M5 2.5h14A2.5 2.5 0 0 1 21.5 5v14a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 19V5A2.5 2.5 0 0 1 5 2.5z',
  shield: 'M12 22.5s9.5-3.8 9.5-11.5V4.5L12 1.5 2.5 4.5V11c0 7.7 9.5 11.5 9.5 11.5z',
  diamond: 'M12 1 23 12 12 23 1 12z',
}

/** How big the glyph sits inside a status frame (fraction of the frame). */
export const GLYPH_INSET = 0.56

export const hasGlyph = (name: string | undefined): name is string => !!name && Object.prototype.hasOwnProperty.call(GLYPHS, name)

/**
 * Strokes glyph `name` into a `size`-pixel square at (x, y) on a canvas. `stroke` is in grid units
 * (pass ICON_STROKE). False when there is no such glyph or the browser has no Path2D.
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string, stroke: number): boolean {
  if (!hasGlyph(name) || typeof Path2D === 'undefined') return false
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of GLYPHS[name]!) ctx.stroke(new Path2D(d))
  ctx.restore()
  return true
}
