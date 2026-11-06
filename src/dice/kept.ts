/**
 * Which dice of a roll count towards the total. `4d6kh3` keeps the three highest, `2d20kl1` the
 * lowest; everything else keeps every die. Pure, so the roll toast and the chat log can strike
 * dropped dice out without re-rolling anything.
 */
import { parseFormula, type ParsedFormula } from './fair'

/** One flag per die, in formula order: true when the die is counted. Unparseable formulas keep all. */
export function keptMask(formula: string | ParsedFormula, dice: { value: number }[]): boolean[] {
  let parsed: ParsedFormula
  try {
    parsed = typeof formula === 'string' ? parseFormula(formula) : formula
  } catch {
    return dice.map(() => true)
  }
  const expected = parsed.terms.reduce((n, t) => n + t.count, 0)
  if (expected !== dice.length) return dice.map(() => true)
  const kept = dice.map(() => true)
  let i = 0
  for (const t of parsed.terms) {
    if (t.keep && t.keepN !== undefined) {
      // Rank the term's dice (stable, so ties drop the later die) and drop those past keepN.
      const order = dice.slice(i, i + t.count).map((d, k) => ({ k: i + k, v: d.value }))
      order.sort((a, b) => (t.keep === 'highest' ? b.v - a.v : a.v - b.v) || a.k - b.k)
      for (const { k } of order.slice(t.keepN)) kept[k] = false
    }
    i += t.count
  }
  return kept
}

/** True when any die of the roll is dropped. */
export function hasDropped(formula: string | ParsedFormula, dice: { value: number }[]): boolean {
  return keptMask(formula, dice).some((k) => !k)
}
