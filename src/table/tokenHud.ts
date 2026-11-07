/**
 * Pure helpers for the combat state drawn on a token's footprint (`TokenMesh`): the primary
 * resource read off a sheet for the HP bar, the colour band it falls in (and its bloodied / down
 * backup), and the condition chips around the disc: category border shape and colour, a monochrome
 * glyph and the turns left when the game tracks durations. No three.js here so it stays testable.
 */
import type { Character, Token } from '@/core/doc'
import type { ConditionDef, ResourceDef } from '@/core/pack'
import { HP_HIGH, HP_LOW, HP_MID, STATUS } from '@/ui/theme/palette'
import { CATEGORY_SHAPE, hasGlyph, STATUS_CATEGORIES, type StatusCategory, type StatusShape } from '@/ui/theme/glyphs'

export interface ResourceReading {
  current: number
  max: number
}

/**
 * Current and maximum of a pack resource on a sheet. The sheet stores it as `{ current, max }`
 * (the `resource` field of `SheetView`) or as a bare number; a missing max falls back to
 * `evalMax` over the pack's `max` expression. Null when the sheet does not track it or the
 * maximum is unknown, so the bar is hidden rather than drawn wrong.
 */
export function readResource(
  data: Record<string, unknown>,
  resource: ResourceDef | undefined,
  evalMax?: (expr: string) => unknown,
): ResourceReading | null {
  if (!resource) return null
  const v = data[resource.id]
  let current: number | undefined
  let max: number | undefined
  if (typeof v === 'number') current = v
  else if (v && typeof v === 'object') {
    const o = v as { current?: unknown; max?: unknown }
    if (typeof o.current === 'number') current = o.current
    if (typeof o.max === 'number') max = o.max
  }
  if (current === undefined || !Number.isFinite(current)) return null
  if (max === undefined && evalMax) {
    try {
      const m = evalMax(resource.max)
      if (typeof m === 'number') max = m
    } catch { /* dice or unknown identifiers in the expression: no bar */ }
  }
  if (max === undefined || !Number.isFinite(max) || max <= 0) return null
  return { current: Math.max(0, current), max }
}

export type HpBand = 'high' | 'mid' | 'low'

/** Colour band of a resource at `current / max`: above half, above a quarter, or critical. */
export function hpBand(current: number, max: number): HpBand {
  const r = max > 0 ? current / max : 0
  return r > 0.5 ? 'high' : r > 0.25 ? 'mid' : 'low'
}

export const HP_BAND_COLORS: Record<HpBand, string> = { high: HP_HIGH, mid: HP_MID, low: HP_LOW }

/** Bars up to this many points are split into pips; longer ones are a continuous fill. */
export const MAX_PIPS = 12

/**
 * HP backup beside the colour band: bloodied at half or less, down at zero, null above half.
 * The token bar and the floor bar draw a drop or a skull for these, so the state reads without colour.
 */
export type HpState = 'bloodied' | 'down' | null
export function hpState(current: number, max: number): HpState {
  if (max <= 0) return null
  if (current <= 0) return 'down'
  return current / max <= 0.5 ? 'bloodied' : null
}

/** Border colour per status category (the frame shape carries the same meaning). */
export const CATEGORY_COLORS: Record<StatusCategory, string> = STATUS
/** Border of a condition the pack does not define. */
export const UNKNOWN_CONDITION_COLOR = '#8a8f99'

/**
 * Category of a condition: the pack's `category` when it names one, else a guess from well-known
 * condition names, else harm. Control is anything that takes away actions or movement.
 */
const KNOWN_CATEGORIES: Record<string, StatusCategory> = {
  stunned: 'control', paralyzed: 'control', paralysed: 'control', restrained: 'control', grappled: 'control', prone: 'control',
  incapacitated: 'control', petrified: 'control', unconscious: 'control', charmed: 'control', frightened: 'control', asleep: 'control',
  poisoned: 'affliction', diseased: 'affliction', cursed: 'affliction', exhaustion: 'affliction', exhausted: 'affliction',
  hungry: 'affliction', bleeding: 'affliction', burning: 'affliction',
  blessed: 'buff', hasted: 'buff', invisible: 'buff', inspired: 'buff', 'shield-of-faith': 'buff',
  concentrating: 'magic', concentration: 'magic', drained: 'magic', hexed: 'magic',
}
export function conditionCategory(id: string, def: Pick<ConditionDef, 'category'> | undefined): StatusCategory {
  if (def?.category && STATUS_CATEGORIES.includes(def.category)) return def.category
  return KNOWN_CATEGORIES[id.toLowerCase()] ?? 'harm'
}

export interface ConditionChip {
  id: string
  /** One or two upper-case letters, drawn when there is no glyph (pack conditions without an icon). */
  label: string
  name: string
  /** Border colour: the category colour, grey for conditions the pack does not know. */
  color: string
  category: StatusCategory
  shape: StatusShape
  /** Monochrome glyph name from theme/glyphs.ts, or null to draw `label` instead. */
  glyph: string | null
  /** Turns left when the game tracks a duration; null when it does not. */
  turns: number | null
  /** One turn left: the chip pulses. */
  last: boolean
}

/** "Shield of Faith" -> "SF", "Injured" -> "IN". */
export function chipLabel(name: string): string {
  const words = name.trim().split(/[\s-]+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

/** Look of one condition (shared by the token chips, the token bar and the character card). */
export function conditionLook(id: string, defs: readonly ConditionDef[], turns: number | null = null): ConditionChip {
  const def = defs.find((d) => d.id === id)
  const category = conditionCategory(id, def)
  return {
    id,
    label: chipLabel(def?.name ?? id),
    name: def?.name ?? id,
    color: def ? CATEGORY_COLORS[category] : UNKNOWN_CONDITION_COLOR,
    category,
    shape: CATEGORY_SHAPE[category],
    glyph: hasGlyph(def?.icon) ? def.icon : null,
    turns,
    last: turns === 1,
  }
}

const TURN_KEYS = ['turns', 'remaining', 'rounds', 'duration'] as const
const turnsOf = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.ceil(v)
  if (v && typeof v === 'object') {
    for (const k of TURN_KEYS) {
      const n = (v as Record<string, unknown>)[k]
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.ceil(n)
    }
  }
  return null
}

/**
 * Turns remaining per condition id, from whatever duration data the token or sheet carries:
 * an object list entry (`{ id, turns }`, also `remaining` / `rounds` / `duration`) or a side map
 * (`conditionDurations` / `durations`: id -> number or such an object). Absent data gives no entry,
 * so conditions without durations simply show no badge.
 */
export function conditionTurns(token: object, character: Pick<Character, 'data'> | undefined): Map<string, number> {
  const out = new Map<string, number>()
  const read = (src: unknown) => {
    if (!src || typeof src !== 'object') return
    const rec = src as Record<string, unknown>
    if (Array.isArray(rec.conditions)) {
      for (const c of rec.conditions) {
        const id = c && typeof c === 'object' ? (c as { id?: unknown }).id : undefined
        const n = turnsOf(c)
        if (typeof id === 'string' && n !== null && !out.has(id)) out.set(id, n)
      }
    }
    for (const key of ['conditionDurations', 'durations']) {
      const map = rec[key]
      if (!map || typeof map !== 'object' || Array.isArray(map)) continue
      for (const [id, v] of Object.entries(map as Record<string, unknown>)) {
        const n = turnsOf(v)
        if (n !== null && !out.has(id)) out.set(id, n)
      }
    }
  }
  read(token)
  read(character?.data)
  return out
}

/**
 * Conditions to show on a token: the token's own list plus the sheet's `conditions` (the engine
 * writes skill effects there), deduplicated in order. Entries may be ids or `{ id, turns }` objects.
 * Ids the pack does not know still get a grey chip so nothing is silently dropped.
 */
export function conditionChips(
  token: Pick<Token, 'conditions'>,
  character: Pick<Character, 'data'> | undefined,
  defs: readonly ConditionDef[],
): ConditionChip[] {
  const ids: string[] = []
  const push = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const x of list) {
      const id = typeof x === 'string' ? x : x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
    }
  }
  push(token.conditions)
  push(character?.data.conditions)
  const turns = conditionTurns(token, character)
  return ids.map((id) => conditionLook(id, defs, turns.get(id) ?? null))
}

/** Where chip `i` of `n` sits around the disc: angles from the upper right, spaced 40 degrees. */
export function chipAngle(i: number): number {
  return Math.PI / 4 - i * (40 * Math.PI) / 180
}
