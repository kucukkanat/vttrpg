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
    // A sheet formula (`2d20kh1 + dex_mod + pb`): read its dice terms in order and ignore the rest.
    const terms = typeof formula === 'string' ? diceTermsOf(formula) : null
    if (!terms) return dice.map(() => true)
    parsed = { terms, modifier: 0, raw: formula as string }
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

/** Dice terms of an expression in source order, or null when a term does not parse. */
function diceTermsOf(src: string): ParsedFormula['terms'] | null {
  const out: ParsedFormula['terms'] = []
  for (const m of src.matchAll(/(?<![A-Za-z0-9_.'"])\d*d\d+(?:k[hl]\d+)?(?![A-Za-z0-9_.])/g)) {
    try {
      out.push(...parseFormula(m[0]).terms)
    } catch {
      return null
    }
  }
  return out.length ? out : null
}

/** True when any die of the roll is dropped. */
export function hasDropped(formula: string | ParsedFormula, dice: { value: number }[]): boolean {
  return keptMask(formula, dice).some((k) => !k)
}
