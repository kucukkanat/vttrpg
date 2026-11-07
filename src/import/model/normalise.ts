/**
 * Normalisation maths: the real-size guess and the bottom-centre pivot. Pure functions, no three.js
 * or glTF Transform, so they are cheap to test and can run anywhere.
 *
 * glTF units are metres, but most downloaded models ignore that: Sketchfab exports are often in
 * centimetres, STL is usually millimetres, and 3D-print miniatures are 25–35 mm tall. The guess
 * keeps the source scale when it is plausible for the category and otherwise tries the common
 * units, then falls back to the category's typical size. The UI shows the result for the GM to
 * confirm (research_notes/Level design/model sources.md, "Scale normalisation").
 */
import type { SizeGuess, SourceFormat } from './types'

export type Vec3 = [number, number, number]

interface CategorySize {
  /** Plausible range of the largest dimension, metres. */
  min: number
  max: number
  /** Typical largest dimension, used when nothing else fits. */
  typical: number
}

export const CATEGORY_SIZES: Record<string, CategorySize> = {
  furniture: { min: 0.25, max: 5, typical: 1 },
  container: { min: 0.15, max: 3, typical: 0.8 },
  light: { min: 0.08, max: 6, typical: 0.5 },
  nature: { min: 0.1, max: 40, typical: 3 },
  structure: { min: 0.8, max: 80, typical: 4 },
  decor: { min: 0.04, max: 3, typical: 0.4 },
  creature: { min: 0.15, max: 30, typical: 1.8 },
  kit: { min: 0.5, max: 12, typical: 3 },
}

const DEFAULT_SIZE: CategorySize = { min: 0.05, max: 50, typical: 1 }

export const CATEGORIES = ['furniture', 'container', 'light', 'nature', 'structure', 'decor', 'creature', 'kit'] as const

export function categorySize(category?: string): CategorySize {
  return (category && CATEGORY_SIZES[category]) || DEFAULT_SIZE
}

const UNITS: Array<{ reason: 'centimetres' | 'millimetres' | 'inches'; scale: number }> = [
  { reason: 'centimetres', scale: 0.01 },
  { reason: 'millimetres', scale: 0.001 },
  { reason: 'inches', scale: 0.0254 },
]

const fmt = (m: number) => (m >= 10 ? `${m.toFixed(0)} m` : m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`)

function guess(scale: number, size: Vec3, reason: SizeGuess['reason'], note: string): SizeGuess {
  return { scale, size: size.map((v) => v * scale) as Vec3, reason, note }
}

/**
 * Guesses the uniform factor that turns source units into metres.
 * @param size source bounds [x, y, z] after the up-axis fix, in source units
 */
export function guessRealSize(size: Vec3, opts: { format?: SourceFormat; category?: string; knownSize?: Vec3 } = {}): SizeGuess {
  const largest = Math.max(...size)
  if (!(largest > 0) || !Number.isFinite(largest)) return { scale: 1, size: [0, 0, 0], reason: 'source', note: 'The model has no size.' }
  const cat = categorySize(opts.category)

  if (opts.knownSize && Math.max(...opts.knownSize) > 0) {
    const s = Math.max(...opts.knownSize) / largest
    const g = guess(s, size, 'known', '')
    g.note = `Scaled to the size the source publishes (${fmt(Math.max(...g.size))} across).`
    return g
  }

  if (opts.format === 'stl') {
    const mm = largest * 0.001
    // A 3D-print miniature: offer it at creature size instead of 3 cm.
    if (mm >= 0.012 && mm <= 0.06 && (!opts.category || opts.category === 'creature')) {
      const target = categorySize('creature').typical
      const s = target / (size[1] > 0 ? size[1] : largest)
      return guess(s, size, 'miniature', `Looks like a ${Math.round(mm * 1000)} mm miniature; scaled up to a ${fmt(target)} creature.`)
    }
    if (mm >= cat.min && mm <= cat.max) return guess(0.001, size, 'millimetres', `STL in millimetres: ${fmt(mm)} across.`)
  }

  if (largest >= cat.min && largest <= cat.max) return guess(1, size, 'source', `Kept the file's own scale: ${fmt(largest)} across.`)

  if (largest > cat.max) {
    // Of the units that land in the plausible range, take the one closest to the typical size.
    const fits = UNITS.map((u) => ({ ...u, m: largest * u.scale }))
      .filter((u) => u.m >= cat.min && u.m <= cat.max)
      .sort((a, b) => Math.abs(Math.log(a.m / cat.typical)) - Math.abs(Math.log(b.m / cat.typical)))
    const u = fits[0]
    if (u) return guess(u.scale, size, u.reason, `Looks like ${u.reason}; scaled to ${fmt(u.m)} across.`)
  }

  const s = cat.typical / largest
  return guess(s, size, 'category', `The file's units look wrong; scaled to a typical ${opts.category ?? 'prop'} size (${fmt(cat.typical)} across).`)
}

/**
 * Translation that puts the bottom centre of the scaled bounds at the origin: x and z centred,
 * the lowest point on y = 0.
 */
export function pivotOffset(min: Vec3, max: Vec3, scale: number): Vec3 {
  const z = (v: number) => (Object.is(v, -0) ? 0 : v)
  return [z(-((min[0] + max[0]) / 2) * scale), z(-min[1] * scale), z(-((min[2] + max[2]) / 2) * scale)]
}

/** Bounds of a Z-up box once rotated -90° about X to be Y-up: (x, y, z) → (x, z, -y). */
export function zUpToYUp(min: Vec3, max: Vec3): { min: Vec3; max: Vec3 } {
  return { min: [min[0], min[2], -max[1]], max: [max[0], max[2], -min[1]] }
}

/** Quaternion [x, y, z, w] for -90° about X (Z-up to Y-up). */
export const Z_UP_TO_Y_UP: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]

const CATEGORY_WORDS: Array<[string, RegExp]> = [
  ['creature', /\b(creature|monster|character|figure|miniature|mini|animal|dragon|goblin|orc|skeleton|zombie|knight|warrior|beast|wolf|horse|rigged)\b/],
  ['light', /\b(lamp|lantern|torch|candle|chandelier|light|lighting|brazier|sconce)\b/],
  ['container', /\b(barrel|crate|chest|box|basket|sack|bag|container|jar|pot|urn|bucket|coffin)\b/],
  ['furniture', /\b(chair|table|bed|bench|stool|shelf|shelves|cabinet|desk|sofa|couch|wardrobe|throne|seating|furniture|dresser)\b/],
  ['nature', /\b(tree|bush|plant|plants|rock|rocks|stone|flower|flowers|grass|mushroom|log|stump|nature|trees|ground cover|fern)\b/],
  ['structure', /\b(wall|door|gate|house|building|buildings|tower|bridge|fence|pillar|column|arch|stairs|ruin|structure|structures|well)\b/],
  ['decor', /\b(book|bottle|cup|mug|plate|dish|dishes|vase|vases|statue|painting|rug|banner|skull|candle|food|tool|tools|decor|decorative|weapon|sword)\b/],
]

/** A category from free-text hints (title, tags, provider categories); undefined when unsure. */
export function guessCategory(words: Array<string | undefined>): string | undefined {
  const text = words.filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ')
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(text)) return cat
  return undefined
}
