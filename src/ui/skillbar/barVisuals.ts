/**
 * Pure helpers for the visual token bar: the HP meter (pips or a continuous bar, coloured like the
 * token's own bar), cost badges with short resource tags, the reach a skill chip previews on the
 * table, and the condition chip colours. No React here so it stays testable.
 */
import type { TargetShape } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import type { ConditionDef, SkillDef } from '@/core/pack'
import { conditionLook, HP_BAND_COLORS, hpBand, hpState, MAX_PIPS, type ConditionChip, type HpBand, type HpState } from '@/table/tokenHud'

export interface HpMeter {
  /** Up to MAX_PIPS points are drawn as pips; more as one continuous fill. */
  mode: 'pips' | 'bar'
  /** Pips mode: how many pips in all (= max) and how many are lit. */
  pips: number
  lit: number
  /** Filled share 0..1 (both modes). */
  fraction: number
  band: HpBand
  color: string
  /** Bloodied (half or less) or down (zero): drawn as a glyph beside the meter. */
  state: HpState
}

export function hpMeter(current: number, max: number): HpMeter {
  const m = Math.max(0, Math.round(max))
  const c = Math.max(0, Math.min(m, Math.round(current)))
  const band = hpBand(c, m)
  return {
    mode: m > 0 && m <= MAX_PIPS ? 'pips' : 'bar',
    pips: m <= MAX_PIPS ? m : 0,
    lit: m <= MAX_PIPS ? c : 0,
    fraction: m > 0 ? c / m : 0,
    band,
    color: HP_BAND_COLORS[band],
    state: hpState(c, m),
  }
}

/**
 * A short upper-case tag for a resource or attribute name: "Hit points" -> "HP",
 * "1st-level slot" -> "LS1", "Willpower" -> "WIL", "WIL" stays.
 */
export function resourceAbbr(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) {
    const w = words[0]!
    return (w.length <= 4 ? w : w.slice(0, 3)).toUpperCase()
  }
  let letters = ''
  let digits = ''
  for (const w of words) {
    const d = /^\d+/.exec(w)
    if (d) digits += d[0]
    else letters += w[0]!
  }
  return (letters.slice(0, 3) + digits).toUpperCase()
}

export interface CostBadge {
  /** The cost as written ("1", "level"). */
  amount: string
  /** Literal amounts 1..3 draw as that many dots; null draws the amount as text. */
  dots: number | null
  /** Short tag ("WIL", "HP"). */
  tag: string
  /** Full description for titles and screen readers ("1 Willpower"). */
  title: string
}

export function costBadges(skill: Pick<SkillDef, 'cost'>, labelOf: (id: string) => string): CostBadge[] {
  return (skill.cost ?? []).map((c) => {
    const n = Number(c.amount)
    const literal = c.amount.trim() !== '' && Number.isInteger(n)
    const label = labelOf(c.resource)
    return {
      amount: c.amount,
      dots: literal && n >= 1 && n <= 3 ? n : null,
      tag: resourceAbbr(label),
      title: `${c.amount} ${label}`,
    }
  })
}

/** What a skill chip shows on the table while it is hovered or pressed. */
export interface RangePreview {
  source: TokenId
  /** Reach in cells around the source; 0 for `self` (the token itself is highlighted). */
  cells: number
}

export function reachCells(shape: TargetShape): number {
  return shape.kind === 'self' ? 0 : Math.max(0, shape.range)
}

export function rangePreviewFor(skill: Pick<SkillDef, 'target'>, source: TokenId): RangePreview {
  return { source, cells: reachCells(skill.target) }
}

/** Look of a pack condition (category frame, glyph or letters), matching the chips drawn around the token. */
export function conditionStyle(defs: readonly ConditionDef[], id: string, turns: number | null = null): ConditionChip {
  return conditionLook(id, defs, turns)
}
