/**
 * Expression DSL used by system packs. Tokenizer + recursive descent parser +
 * a small tree-walking evaluator. No `eval`, no `Function`.
 *
 * Grammar (lowest to highest precedence):
 *   ternary     cond ? a : b
 *   or          a or b
 *   and         a and b
 *   not         not a
 *   comparison  < <= > >= == !=          (non-associative)
 *   additive    + -
 *   multiplic.  * / %
 *   unary       -a
 *   primary     number | 'string' | true | false | dice | identifier | fn(args) | ( expr )
 *
 * Identifiers are dotted paths (`str.current`, `inventory.0.name`) resolved by a
 * scope callback. Dice terms (`d20`, `2d6`, `4d6kh3`) are consumed from a seed via
 * `src/dice/fair.ts`, left to right in evaluation order. The evaluator is
 * synchronous; `DiceStream` bridges to the async SHA-256 derivation by re-running
 * the (pure) evaluation until every requested die is known.
 */
import { diceFromSeed, parseFormula, totalFromDice, type ParsedFormula } from '@/dice/fair'

export type Value = number | string | boolean

/** Resolves a dotted identifier path to a value; `undefined` means unknown. */
export type Scope = (path: string[]) => unknown

/** Synchronous die source used by the evaluator. */
export interface SyncDice {
  next(sides: number): number
}

export class ExprError extends Error {
  constructor(message: string, readonly source?: string) {
    super(source ? `${message} in "${source}"` : message)
    this.name = 'ExprError'
  }
}

// ---------------------------------------------------------------- tokenizer

type DiceTerm = ParsedFormula['terms'][number]

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'dice'; term: DiceTerm }
  | { t: 'op'; v: string }
  | { t: 'kw'; v: 'and' | 'or' | 'not' | 'true' | 'false' }
  | { t: 'end' }

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false'])
const DICE_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/
const NUM_RE = /^\d+(?:\.\d+)?$/
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/
const TWO_CHAR_OPS = ['<=', '>=', '==', '!=']
const ONE_CHAR_OPS = '+-*/%(),?:<>'

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1)
      if (end < 0) throw new ExprError('unterminated string', src)
      out.push({ t: 'str', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO_CHAR_OPS.includes(two)) {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if (ONE_CHAR_OPS.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    if (/[A-Za-z0-9_.]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++
      const word = src.slice(i, j)
      i = j
      if (NUM_RE.test(word)) out.push({ t: 'num', v: Number(word) })
      else if (DICE_RE.test(word)) {
        let parsed: ParsedFormula
        try {
          parsed = parseFormula(word)
        } catch (e) {
          throw new ExprError((e as Error).message, src)
        }
        out.push({ t: 'dice', term: parsed.terms[0] })
      } else if (KEYWORDS.has(word)) out.push({ t: 'kw', v: word as 'and' })
      else if (ID_RE.test(word)) out.push({ t: 'id', v: word })
      else throw new ExprError(`unexpected token "${word}"`, src)
      continue
    }
    throw new ExprError(`unexpected character "${c}"`, src)
  }
  out.push({ t: 'end' })
  return out
}

// ------------------------------------------------------------------- parser

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'id'; path: string[]; name: string }
  | { k: 'dice'; term: DiceTerm }
  | { k: 'un'; op: '-' | 'not'; e: Ast }
  | { k: 'bin'; op: string; l: Ast; r: Ast }
  | { k: 'cond'; c: Ast; t: Ast; f: Ast }
  | { k: 'call'; fn: string; args: Ast[] }

export function parse(src: string): Ast {
  const toks = tokenize(src)
  let pos = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]
  const isOp = (v: string) => {
    const t = peek()
    return t.t === 'op' && t.v === v
  }
  const isKw = (v: string) => {
    const t = peek()
    return t.t === 'kw' && t.v === v
  }
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}"`, src)
    pos++
  }

  function ternary(): Ast {
    const c = or()
    if (!isOp('?')) return c
    pos++
    const t = ternary()
    expectOp(':')
    const f = ternary()
    return { k: 'cond', c, t, f }
  }
  function or(): Ast {
    let l = and()
    while (isKw('or')) {
      pos++
      l = { k: 'bin', op: 'or', l, r: and() }
    }
    return l
  }
  function and(): Ast {
    let l = not()
    while (isKw('and')) {
      pos++
      l = { k: 'bin', op: 'and', l, r: not() }
    }
    return l
  }
  function not(): Ast {
    if (isKw('not')) {
      pos++
      return { k: 'un', op: 'not', e: not() }
    }
    return comparison()
  }
  function comparison(): Ast {
    const l = additive()
    const t = peek()
    if (t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      pos++
      return { k: 'bin', op: t.v, l, r: additive() }
    }
    return l
  }
  function additive(): Ast {
    let l = multiplicative()
    for (;;) {
      const t = peek()
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) {
        pos++
        l = { k: 'bin', op: t.v, l, r: multiplicative() }
      } else return l
    }
  }
  function multiplicative(): Ast {
    let l = unary()
    for (;;) {
      const t = peek()
      if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        pos++
        l = { k: 'bin', op: t.v, l, r: unary() }
      } else return l
    }
  }
  function unary(): Ast {
    if (isOp('-')) {
      pos++
      return { k: 'un', op: '-', e: unary() }
    }
    return primary()
  }
  function primary(): Ast {
    const t = next()
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v }
      case 'str':
        return { k: 'str', v: t.v }
      case 'dice':
        return { k: 'dice', term: t.term }
      case 'kw':
        if (t.v === 'true') return { k: 'bool', v: true }
        if (t.v === 'false') return { k: 'bool', v: false }
        throw new ExprError(`unexpected "${t.v}"`, src)
      case 'id': {
        if (isOp('(')) {
          pos++
          const args: Ast[] = []
          if (!isOp(')')) {
            args.push(ternary())
            while (isOp(',')) {
              pos++
              args.push(ternary())
            }
          }
          expectOp(')')
          return { k: 'call', fn: t.v, args }
        }
        return { k: 'id', path: t.v.split('.'), name: t.v }
      }
      case 'op':
        if (t.v === '(') {
          const e = ternary()
          expectOp(')')
          return e
        }
        throw new ExprError(`unexpected "${t.v}"`, src)
      case 'end':
        throw new ExprError('unexpected end of expression', src)
    }
  }

  if (peek().t === 'end') throw new ExprError('empty expression', src)
  const ast = ternary()
  if (peek().t !== 'end') throw new ExprError('unexpected trailing input', src)
  return ast
}

/** True when the expression contains a dice term or a `roll(...)` call. */
export function usesDice(ast: Ast): boolean {
  switch (ast.k) {
    case 'dice':
      return true
    case 'call':
      return ast.fn === 'roll' || ast.args.some(usesDice)
    case 'un':
      return usesDice(ast.e)
    case 'bin':
      return usesDice(ast.l) || usesDice(ast.r)
    case 'cond':
      return usesDice(ast.c) || usesDice(ast.t) || usesDice(ast.f)
    default:
      return false
  }
}

// ---------------------------------------------------------------- evaluator

function num(v: Value, what: string): number {
  if (typeof v !== 'number') throw new ExprError(`${what} expects a number, got ${describe(v)}`)
  return v
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'a list'
  if (typeof v === 'object') return 'an object'
  return `${typeof v} ${JSON.stringify(v)}`
}

function truthy(v: Value): boolean {
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v !== ''
}

function rollTerm(term: DiceTerm, dice: SyncDice): number {
  const vals: { sides: number; value: number }[] = []
  for (let i = 0; i < term.count; i++) vals.push({ sides: term.sides, value: dice.next(term.sides) })
  return totalFromDice({ terms: [term], modifier: 0, raw: '' }, vals)
}

function rollFormulaString(formula: string, dice: SyncDice): number {
  const parsed = parseFormula(formula)
  const vals: { sides: number; value: number }[] = []
  for (const t of parsed.terms) for (let i = 0; i < t.count; i++) vals.push({ sides: t.sides, value: dice.next(t.sides) })
  return totalFromDice(parsed, vals)
}

/** No dice allowed: used where evaluation must be synchronous (intent validation). */
export const NO_DICE: SyncDice = {
  next() {
    throw new ExprError('dice are not allowed in this expression')
  },
}

export function evaluateAst(ast: Ast, scope: Scope, dice: SyncDice): Value {
  const ev = (a: Ast): Value => evaluateAst(a, scope, dice)
  switch (ast.k) {
    case 'num':
    case 'str':
    case 'bool':
      return ast.v
    case 'dice':
      return rollTerm(ast.term, dice)
    case 'id': {
      const v = scope(ast.path)
      if (v === undefined) throw new ExprError(`unknown identifier "${ast.name}"`)
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
      throw new ExprError(`"${ast.name}" is ${describe(v)}, not a value`)
    }
    case 'un': {
      const v = ev(ast.e)
      return ast.op === '-' ? -num(v, 'unary minus') : !truthy(v)
    }
    case 'cond':
      return truthy(ev(ast.c)) ? ev(ast.t) : ev(ast.f)
    case 'bin': {
      if (ast.op === 'and') return truthy(ev(ast.l)) ? truthy(ev(ast.r)) : false
      if (ast.op === 'or') return truthy(ev(ast.l)) ? true : truthy(ev(ast.r))
      const l = ev(ast.l)
      const r = ev(ast.r)
      switch (ast.op) {
        case '==':
          return l === r
        case '!=':
          return l !== r
        case '<':
          return num(l, '<') < num(r, '<')
        case '<=':
          return num(l, '<=') <= num(r, '<=')
        case '>':
          return num(l, '>') > num(r, '>')
        case '>=':
          return num(l, '>=') >= num(r, '>=')
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r)
          return num(l, '+') + num(r, '+')
        case '-':
          return num(l, '-') - num(r, '-')
        case '*':
          return num(l, '*') * num(r, '*')
        case '/': {
          const d = num(r, '/')
          if (d === 0) throw new ExprError('division by zero')
          return num(l, '/') / d
        }
        case '%': {
          const d = num(r, '%')
          if (d === 0) throw new ExprError('division by zero')
          return num(l, '%') % d
        }
      }
      throw new ExprError(`unknown operator ${ast.op}`)
    }
    case 'call': {
      const args = ast.args.map(ev)
      const arity = (n: number) => {
        if (args.length !== n) throw new ExprError(`${ast.fn}() takes ${n} argument${n === 1 ? '' : 's'}`)
      }
      switch (ast.fn) {
        case 'floor':
          arity(1)
          return Math.floor(num(args[0], 'floor'))
        case 'ceil':
          arity(1)
          return Math.ceil(num(args[0], 'ceil'))
        case 'abs':
          arity(1)
          return Math.abs(num(args[0], 'abs'))
        case 'min':
          if (args.length === 0) throw new ExprError('min() needs at least one argument')
          return Math.min(...args.map((a) => num(a, 'min')))
        case 'max':
          if (args.length === 0) throw new ExprError('max() needs at least one argument')
          return Math.max(...args.map((a) => num(a, 'max')))
        case 'clamp': {
          arity(3)
          const [x, lo, hi] = args.map((a) => num(a, 'clamp'))
          return Math.min(hi, Math.max(lo, x))
        }
        case 'roll': {
          arity(1)
          const a = args[0]
          if (typeof a === 'number') return a
          if (typeof a === 'string') {
            try {
              return rollFormulaString(a, dice)
            } catch (e) {
              if (e instanceof NeedDice) throw e
              throw new ExprError(`roll(): ${(e as Error).message}`)
            }
          }
          throw new ExprError('roll() expects a dice formula string or a number')
        }
        default:
          throw new ExprError(`unknown function "${ast.fn}"`)
      }
    }
  }
}

/** Evaluate an expression that must not use dice (synchronous). */
export function evaluateSync(src: string | Ast, scope: Scope): Value {
  const ast = typeof src === 'string' ? parse(src) : src
  return evaluateAst(ast, scope, NO_DICE)
}

// -------------------------------------------------------------- dice stream

/** Thrown by the stream's die source when a die beyond the known prefix is requested. */
class NeedDice {
  constructor(readonly sides: number) {}
}

/**
 * A deterministic sequence of dice derived from one seed. Die i of the stream is
 * fair.ts die i, so the order of requests fully determines the values. `run`
 * executes a pure, synchronous computation that may request dice; whenever it
 * asks for a die that is not yet known, the stream derives it and re-runs the
 * computation from the start. Dice consumed by a completed `run` stay consumed
 * for later runs, so several expressions can share one seed.
 */
export class DiceStream {
  private committed: { sides: number; value: number }[] = []

  constructor(readonly seed: string) {}

  /** Every die consumed so far, in order. */
  get dice(): { sides: number; value: number }[] {
    return this.committed.slice()
  }

  async run<T>(fn: (dice: SyncDice) => T): Promise<T> {
    let known = this.committed
    for (;;) {
      let i = 0
      const source: SyncDice = {
        next: (sides) => {
          if (i < known.length) {
            const d = known[i++]
            if (d.sides !== sides) throw new Error('dice stream desync: evaluation is not deterministic')
            return d.value
          }
          throw new NeedDice(sides)
        },
      }
      try {
        const out = fn(source)
        this.committed = known.slice(0, i)
        return out
      } catch (e) {
        if (!(e instanceof NeedDice)) throw e
        const sides = [...known.map((d) => d.sides), e.sides]
        known = await diceFromSeed({ terms: sides.map((s) => ({ count: 1, sides: s })), modifier: 0, raw: '' }, this.seed)
      }
    }
  }

  /** Roll one die directly (used for table lookups and choices). */
  next(sides: number): Promise<number> {
    return this.run((d) => d.next(sides))
  }
}

/** Parse + evaluate against a seed; dice are consumed from the stream in order. */
export async function evaluate(src: string | Ast, scope: Scope, stream: DiceStream): Promise<Value> {
  const ast = typeof src === 'string' ? parse(src) : src
  return stream.run((dice) => evaluateAst(ast, scope, dice))
}

// ------------------------------------------------------------------- scopes

/** Scope over a plain object: dotted paths walk nested objects and arrays. */
export function objectScope(obj: unknown): Scope {
  return (path) => getPath(obj, path)
}

/**
 * Compose named sub-scopes over a base scope: `target.hp.current` is sent to
 * `parts.target(['hp','current'])`; anything else goes to `base`.
 */
export function composeScope(parts: Record<string, Scope | unknown>, base: Scope): Scope {
  return (path) => {
    if (path.length && path[0] in parts) {
      const p = parts[path[0]]
      return typeof p === 'function' ? (p as Scope)(path.slice(1)) : getPath(p, path.slice(1))
    }
    return base(path)
  }
}

export function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** Set a nested value, creating intermediate objects (or arrays for numeric segments). */
export function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    const nxt = cur[seg]
    if (nxt === null || nxt === undefined || typeof nxt !== 'object') {
      const created: unknown = /^\d+$/.test(path[i + 1]) ? [] : {}
      cur[seg] = created
      cur = created as Record<string, unknown>
    } else cur = nxt as Record<string, unknown>
  }
  cur[path[path.length - 1]] = value
}
