/**
 * Fair, deterministic dice. Pure and dependency-free so both the rules engine
 * and the table can use it and every client derives identical results.
 *
 * Protocol (commit/reveal):
 *   1. Roller creates `seed` = 32 random bytes as lowercase hex.
 *   2. Roller publishes `commit` = sha256(utf8(seed)) as hex (ephemeral presence).
 *   3. Roller publishes the roll intent carrying `seed`.
 *   4. Everyone checks sha256(seed) === commit, then computes the dice.
 *
 * Die i (0-based, in formula order) = (uint64BE(sha256(utf8(`${seed}:${i}`))[0..8]) mod sides) + 1.
 */
export interface ParsedFormula {
  terms: DiceTerm[]
  modifier: number
  raw: string
}

export interface DiceTerm {
  count: number
  sides: number
  keep?: 'highest' | 'lowest'
  keepN?: number
  /** `d66`: two d6 read as tens and ones (11–66), the Mausritter table die. `count` is 2, `sides` 6. */
  d66?: true
}

const te = new TextEncoder()

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', te.encode(s))
  return toHex(new Uint8Array(buf))
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function newSeed(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

export function commitSeed(seed: string): Promise<string> {
  return sha256Hex(seed)
}

export async function verifyCommit(seed: string, commit: string): Promise<boolean> {
  return (await sha256Hex(seed)) === commit.toLowerCase()
}

/**
 * Parses formulas like "d20", "2d6+3", "4d6kh3", "3d6kl1 - 1", "d20 + 2d4 + 1".
 * `d66` is two d6 read as tens and ones (11–66), not a 66-sided die; it takes no count or keep.
 * Whitespace is ignored. Throws on anything else.
 */
export function parseFormula(formula: string): ParsedFormula {
  const raw = formula
  const src = formula.replace(/\s+/g, '').toLowerCase()
  if (!src) throw new Error('empty formula')
  const terms: ParsedFormula['terms'] = []
  let modifier = 0
  const re = /([+-]?)(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/gy
  let m: RegExpExecArray | null
  let consumed = 0
  while ((m = re.exec(src))) {
    consumed = re.lastIndex
    const sign = m[1] === '-' ? -1 : 1
    if (m[6] !== undefined) {
      modifier += sign * Number(m[6])
      continue
    }
    if (sign < 0) throw new Error(`negative dice term not supported in "${raw}"`)
    const count = m[2] === '' ? 1 : Number(m[2])
    const sides = Number(m[3])
    if (m[3] === '66') {
      if (count !== 1 || m[4]) throw new Error(`d66 takes no count or keep in "${raw}"`)
      terms.push({ count: 2, sides: 6, d66: true })
      continue
    }
    if (count < 1 || count > 100) throw new Error(`bad die count in "${raw}"`)
    if (sides < 2 || sides > 1000) throw new Error(`bad die sides in "${raw}"`)
    const term: ParsedFormula['terms'][number] = { count, sides }
    if (m[4]) {
      term.keep = m[4] === 'kh' ? 'highest' : 'lowest'
      term.keepN = Number(m[5])
      if (term.keepN < 1 || term.keepN > count) throw new Error(`bad keep in "${raw}"`)
    }
    terms.push(term)
  }
  if (consumed !== src.length) throw new Error(`cannot parse formula "${raw}"`)
  return { terms, modifier, raw }
}

/** Synchronous SHA-256 is not available in WebCrypto; use the async variant. */
export async function diceFromSeed(
  formula: ParsedFormula,
  seed: string,
): Promise<{ sides: number; value: number }[]> {
  const out: { sides: number; value: number }[] = []
  let i = 0
  for (const t of formula.terms) {
    for (let k = 0; k < t.count; k++, i++) {
      const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(`${seed}:${i}`)))
      let n = 0n
      for (let b = 0; b < 8; b++) n = (n << 8n) | BigInt(buf[b])
      out.push({ sides: t.sides, value: Number(n % BigInt(t.sides)) + 1 })
    }
  }
  return out
}

/** Applies keep-highest/lowest and the modifier. `dice` must come from `diceFromSeed(formula)`. */
export function totalFromDice(formula: ParsedFormula, dice: { sides: number; value: number }[]): number {
  let total = formula.modifier
  let i = 0
  for (const t of formula.terms) {
    const vals = dice.slice(i, i + t.count).map((d) => d.value)
    i += t.count
    if (t.d66) total += (vals[0] ?? 0) * 10 + (vals[1] ?? 0)
    else if (t.keep) {
      vals.sort((a, b) => (t.keep === 'highest' ? b - a : a - b))
      total += vals.slice(0, t.keepN).reduce((a, b) => a + b, 0)
    } else total += vals.reduce((a, b) => a + b, 0)
  }
  return total
}

/** Convenience: parse, derive, total. */
export async function rollFromSeed(formula: string, seed: string) {
  const parsed = parseFormula(formula)
  const dice = await diceFromSeed(parsed, seed)
  return { formula: parsed.raw, seed, dice, total: totalFromDice(parsed, dice) }
}
