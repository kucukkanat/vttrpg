/**
 * Advantage and disadvantage as a formula rewrite: the pack's resolution die (d20 for
 * `d20-vs-dc`, the `roll-under` die otherwise) is rolled twice and the better or worse kept.
 * "Better" depends on the resolution: high for d20-vs-dc, low for roll-under (Mausritter).
 * Pure; the rewritten formula is what the chat shows, so the dice speak for themselves.
 */
import type { RollAdvantage } from '@/core/doc'
import type { RollResolution } from '@/core/pack'
import { parseFormula } from '@/dice/fair'
import { tokenize } from './expr'

/** Sides of the die advantage doubles. */
export function advantageDie(resolution: RollResolution | undefined): number {
  if (resolution?.kind === 'roll-under') {
    try {
      return parseFormula(resolution.die).terms[0]?.sides ?? 20
    } catch {
      return 20
    }
  }
  return 20
}

/**
 * The formula with its first single resolution die (`d20` or `1d20`, not `2d20` or `d20kh1`)
 * doubled and one kept. Null when there is no such die (a damage roll, an already doubled die).
 */
export function withAdvantage(formula: string, mode: RollAdvantage, resolution?: RollResolution): string | null {
  const sides = advantageDie(resolution)
  const highIsGood = resolution?.kind !== 'roll-under'
  const keep = (mode === 'advantage') === highIsGood ? 'kh1' : 'kl1'
  const re = new RegExp(`(^|[^A-Za-z0-9_.'"])1?d${sides}(?![A-Za-z0-9_.])`)
  const m = re.exec(formula)
  if (!m) return null
  const at = m.index + m[1].length
  return `${formula.slice(0, at)}2d${sides}${keep}${formula.slice(m.index + m[0].length)}`
}

/**
 * The natural roll of the formula's first `sides`-sided term: the kept die of `2d20kh1`, the only
 * die of `d20`. Dice are matched to the term in order among dice of the same size, which holds for
 * formulas whose resolution die is rolled first among its size (every pack formula so far).
 */
export function naturalDie(formula: string, dice: { sides: number; value: number }[], sides: number): number | undefined {
  const same = dice.filter((d) => d.sides === sides).map((d) => d.value)
  if (!same.length) return undefined
  let term: { count: number; keep?: 'highest' | 'lowest'; keepN?: number } | undefined
  try {
    for (const t of tokenize(formula)) if (t.t === 'dice' && t.term.sides === sides) { term = t.term; break }
  } catch {
    // An unparseable formula: fall back to the first die of the size.
  }
  if (!term || !term.keep || term.keepN !== 1) return same[0]
  const vals = same.slice(0, term.count)
  return term.keep === 'highest' ? Math.max(...vals) : Math.min(...vals)
}
