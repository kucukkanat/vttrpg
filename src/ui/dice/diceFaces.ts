/**
 * Pure helpers behind the dice faces of a roll (DiceFace.tsx): pip layout for d6 faces, the outline
 * of the other dice, which dice a `kh`/`kl` dropped, natural max/min, and the spoken summary.
 */
import { keptMask } from '@/dice/kept'

/**
 * Pip cells of a d6 face on a 3×3 grid, row-major (0 = top left, 4 = centre, 8 = bottom right).
 * Values outside 1–6 have no pip layout and return null (the face falls back to the number).
 */
export function pipCells(value: number): number[] | null {
  switch (value) {
    case 1: return [4]
    case 2: return [2, 6]
    case 3: return [2, 4, 6]
    case 4: return [0, 2, 6, 8]
    case 5: return [0, 2, 4, 6, 8]
    case 6: return [0, 2, 3, 5, 6, 8]
    default: return null
  }
}

/** Centre of a pip cell in a 32×32 face. */
export function pipPoint(cell: number): { x: number; y: number } {
  const at = [9, 16, 23]
  return { x: at[cell % 3], y: at[Math.floor(cell / 3)] }
}

export type DieShape = 'pips' | 'triangle' | 'diamond' | 'kite' | 'pentagon' | 'hexagon' | 'round'

/** The outline drawn for a die: a d6 shows pips (when the value has a layout), others a rough polygon. */
export function dieShape(sides: number | undefined, value: number): DieShape {
  switch (sides) {
    case 6: return pipCells(value) ? 'pips' : 'round'
    case 4: return 'triangle'
    case 8: return 'diamond'
    case 10: return 'kite'
    case 12: return 'pentagon'
    case 20: return 'hexagon'
    default: return 'round'
  }
}

/** SVG polygon points (32×32 box) for the polygon shapes; null for pips and round faces. */
export function shapePoints(shape: DieShape): string | null {
  switch (shape) {
    case 'triangle': return '16,2 30.5,28.5 1.5,28.5'
    case 'diamond': return '16,1 31,16 16,31 1,16'
    case 'kite': return '16,1 30.5,13 16,31 1.5,13'
    case 'pentagon': return '16,1 31,12 25.5,30.5 6.5,30.5 1,12'
    case 'hexagon': return '16,1 29.5,8.75 29.5,23.25 16,31 2.5,23.25 2.5,8.75'
    default: return null
  }
}

export interface DieView {
  value: number
  sides?: number
  /** Counted towards the total (false for dice a `kh`/`kl` dropped). */
  kept: boolean
  /** Rolled the highest face (natural 20 on a d20). */
  max: boolean
  /** Rolled a 1 on a die with more than one face. */
  min: boolean
}

/** Per-die flags for a roll, in formula order. */
export function dieViews(formula: string, dice: { value: number; sides?: number }[]): DieView[] {
  const kept = keptMask(formula, dice)
  return dice.map((d, i) => {
    const real = d.sides !== undefined && d.sides > 1
    return { value: d.value, sides: d.sides, kept: kept[i], max: real && d.value === d.sides, min: real && d.value === 1 }
  })
}

/** Spoken form of one die: "20 on d20, natural max", "3 on d6, dropped". */
export function dieLabel(d: DieView): string {
  const parts = [d.sides ? `${d.value} on d${d.sides}` : String(d.value)]
  if (d.max) parts.push('natural max')
  else if (d.min) parts.push('natural 1')
  if (!d.kept) parts.push('dropped')
  return parts.join(', ')
}

export interface RollOutcomeView { success: boolean; critical: boolean }

/** The pack's success/critical reading of a roll, when it gave one. */
export function rollOutcome(outcome: Record<string, unknown> | undefined): RollOutcomeView | null {
  if (!outcome || !('success' in outcome)) return null
  return { success: Boolean(outcome.success), critical: Boolean(outcome.critical) }
}

/** Short tag text for an outcome: "Success", "Fail", "Critical success", "Critical fail". */
export function outcomeText(o: RollOutcomeView): string {
  if (o.critical) return o.success ? 'Critical success' : 'Critical fail'
  return o.success ? 'Success' : 'Fail'
}

/** The roll's label, or null when it is empty or only repeats the formula. */
export function rollLabel(label: string | undefined, formula: string): string | null {
  const t = label?.trim()
  return t && t !== formula.trim() ? t : null
}

/** Full spoken result: "Bramble: STR save, 1d20+3, total 17. Dice: 14 on d20. Success." */
export function rollSummary(
  roll: { formula: string; dice: { value: number; sides?: number }[]; total: number; outcome?: Record<string, unknown> },
  label?: string,
): string {
  const head = [rollLabel(label, roll.formula), roll.formula].filter(Boolean).join(', ')
  let s = `${head}, total ${roll.total}.`
  if (roll.dice.length) s += ` Dice: ${dieViews(roll.formula, roll.dice).map(dieLabel).join('; ')}.`
  const o = rollOutcome(roll.outcome)
  if (o) s += ` ${outcomeText(o)}.`
  return s
}
