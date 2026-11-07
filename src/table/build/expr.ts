/**
 * A tiny arithmetic parser for the numeric inspector and the typed transform keys. No `eval`:
 * a recursive descent over numbers, + - * /, parentheses and unary signs.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := ('+' | '-') unary | atom
 *   atom   := number | '(' expr ')'
 *
 * `applyFieldExpr` adds the inspector's relative forms on top: text starting with `+` adds to the
 * current value (`+0.5`, `+-1`), and text starting with `*` or `/` scales it (`*2`, `/4`).
 * Anything else is an absolute value (`1.5*2`, `-3`).
 */

/** Longest input accepted; longer text is refused rather than parsed. */
const MAX_LENGTH = 200

class ParseError extends Error {}

/** The value of `text`, or null when it is not a finite arithmetic expression. */
export function evalExpr(text: string): number | null {
  // Spaces may sit between tokens, never inside a number ("1 2" is not 12).
  if (/[\d.]\s+[\d.]/.test(text)) return null
  const src = text.replace(/,/g, '.').replace(/\s+/g, '')
  if (!src || src.length > MAX_LENGTH) return null
  let i = 0
  const peek = () => src[i]

  const number = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))
    if (!m) throw new ParseError()
    i += m[0].length
    return Number(m[0])
  }
  const atom = (): number => {
    if (peek() === '(') {
      i++
      const v = expr()
      if (peek() !== ')') throw new ParseError()
      i++
      return v
    }
    return number()
  }
  // Depth guard: a long run of signs or parentheses cannot blow the stack.
  let depth = 0
  const unary = (): number => {
    if (++depth > 64) throw new ParseError()
    try {
      const c = peek()
      if (c === '+') { i++; return unary() }
      if (c === '-') { i++; return -unary() }
      return atom()
    } finally { depth-- }
  }
  const term = (): number => {
    let v = unary()
    for (;;) {
      const c = peek()
      if (c === '*') { i++; v *= unary() } else if (c === '/') { i++; v /= unary() } else return v
    }
  }
  function expr(): number {
    if (++depth > 64) throw new ParseError()
    try {
      let v = term()
      for (;;) {
        const c = peek()
        if (c === '+') { i++; v += term() } else if (c === '-') { i++; v -= term() } else return v
      }
    } finally { depth-- }
  }

  try {
    const v = expr()
    if (i !== src.length || !Number.isFinite(v)) return null
    return v
  } catch (e) {
    if (e instanceof ParseError) return null
    throw e
  }
}

/**
 * A field's new value from what was typed: relative forms (`+0.5`, `*2`, `/2`) act on `current`;
 * anything else is absolute. Null when the text does not parse.
 */
export function applyFieldExpr(text: string, current: number): number | null {
  const t = text.trim()
  if (t.startsWith('*') || t.startsWith('/')) {
    const v = evalExpr(t.slice(1))
    if (v === null) return null
    const out = t[0] === '*' ? current * v : current / v
    return Number.isFinite(out) ? out : null
  }
  if (t.startsWith('+')) {
    const v = evalExpr(t.slice(1))
    return v === null ? null : current + v
  }
  return evalExpr(t)
}
