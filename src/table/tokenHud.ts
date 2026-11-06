/**
 * Pure helpers for the combat state drawn on a token's footprint (`TokenMesh`): the primary
 * resource read off a sheet for the HP bar, the colour band it falls in, and the condition chips
 * around the disc. No three.js here so it stays testable.
 */
import type { Character, Token } from '@/core/doc'
import type { ConditionDef, ResourceDef } from '@/core/pack'

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

export const HP_BAND_COLORS: Record<HpBand, string> = { high: '#5fd36b', mid: '#f2b33d', low: '#e0453a' }

/** Bars up to this many points are split into pips; longer ones are a continuous fill. */
export const MAX_PIPS = 12

/** Distinct chip colours, assigned by the condition's index in the pack list. */
export const CONDITION_PALETTE = ['#e0453a', '#7cc4ff', '#f2b33d', '#9fd356', '#c77dff', '#ff9b4a', '#4fd1c5', '#ff7eb6']
export const UNKNOWN_CONDITION_COLOR = '#8a8f99'

export interface ConditionChip {
  id: string
  /** One or two upper-case letters drawn on the chip. */
  label: string
  name: string
  color: string
}

/** "Shield of Faith" -> "SF", "Injured" -> "IN". */
export function chipLabel(name: string): string {
  const words = name.trim().split(/[\s-]+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

/**
 * Conditions to show on a token: the token's own list plus the sheet's `conditions` (the engine
 * writes skill effects there), deduplicated in order. Ids the pack does not know still get a
 * grey chip so nothing is silently dropped.
 */
export function conditionChips(
  token: Pick<Token, 'conditions'>,
  character: Pick<Character, 'data'> | undefined,
  defs: readonly ConditionDef[],
): ConditionChip[] {
  const ids: string[] = []
  const push = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const x of list) if (typeof x === 'string' && x && !ids.includes(x)) ids.push(x)
  }
  push(token.conditions)
  push(character?.data.conditions)
  return ids.map((id) => {
    const i = defs.findIndex((d) => d.id === id)
    const def = i >= 0 ? defs[i]! : undefined
    return {
      id,
      label: chipLabel(def?.name ?? id),
      name: def?.name ?? id,
      color: i >= 0 ? CONDITION_PALETTE[i % CONDITION_PALETTE.length]! : UNKNOWN_CONDITION_COLOR,
    }
  })
}

/** Where chip `i` of `n` sits around the disc: angles from the upper right, spaced 40 degrees. */
export function chipAngle(i: number): number {
  return Math.PI / 4 - i * (40 * Math.PI) / 180
}
