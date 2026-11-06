import { describe, expect, it } from 'vitest'
import { diceFromSeed, parseFormula, rollFromSeed } from '@/dice/fair'
import { DiceStream, ExprError, composeScope, evaluate, evaluateSync, objectScope, parse, setPath, tokenize, usesDice } from './expr'

const seed = 'ab'.repeat(32)
const ev = (src: string, scope: Record<string, unknown> = {}) => evaluateSync(src, objectScope(scope))

describe('tokenizer', () => {
  it('separates dice, numbers, identifiers and keywords', () => {
    expect(tokenize('2d6 + d20 - dex.current and not 1.5').map((t) => t.t)).toEqual([
      'dice', 'op', 'dice', 'op', 'id', 'kw', 'kw', 'num', 'end',
    ])
  })
  it('reads strings and two-character operators', () => {
    expect(tokenize("'d6' <= x != y").map((t) => ('v' in t ? t.v : t.t))).toEqual(['d6', '<=', 'x', '!=', 'y', 'end'])
  })
  it('rejects garbage', () => {
    expect(() => tokenize('1 $ 2')).toThrow(ExprError)
    expect(() => tokenize("'unterminated")).toThrow(ExprError)
    expect(() => tokenize('a..b')).toThrow(ExprError)
    expect(() => tokenize('4d6kh5')).toThrow(/bad keep/)
  })
})

describe('precedence and arithmetic', () => {
  it('multiplies before adding, and parentheses override', () => {
    expect(ev('1 + 2 * 3')).toBe(7)
    expect(ev('(1 + 2) * 3')).toBe(9)
    expect(ev('10 - 4 - 3')).toBe(3)
    expect(ev('12 / 2 / 3')).toBe(2)
    expect(ev('7 % 3')).toBe(1)
  })
  it('handles unary minus', () => {
    expect(ev('-3 + 5')).toBe(2)
    expect(ev('-(2 + 3) * 2')).toBe(-10)
    expect(ev('2 * -3')).toBe(-6)
    expect(ev('--4')).toBe(4)
  })
  it('compares after arithmetic and before logic', () => {
    expect(ev('1 + 1 == 2')).toBe(true)
    expect(ev('3 < 2 or 2 < 3')).toBe(true)
    expect(ev('3 < 2 and 2 < 3')).toBe(false)
    expect(ev('not 3 < 2')).toBe(true)
    expect(ev('not true or true')).toBe(true) // (not true) or true
    expect(ev('true or false and false')).toBe(true) // and binds tighter
  })
  it('evaluates ternaries right-associatively and lazily', () => {
    expect(ev('1 < 2 ? 10 : 20')).toBe(10)
    expect(ev('false ? 1 : true ? 2 : 3')).toBe(2)
    expect(ev('true ? 1 : 1 / 0')).toBe(1)
  })
  it('provides math functions', () => {
    expect(ev('floor(7 / 2)')).toBe(3)
    expect(ev('ceil(7 / 2)')).toBe(4)
    expect(ev('abs(-4)')).toBe(4)
    expect(ev('min(3, 1, 2)')).toBe(1)
    expect(ev('max(3, 1, 2)')).toBe(3)
    expect(ev('clamp(15, 0, 10)')).toBe(10)
    expect(ev('clamp(-5, 0, 10)')).toBe(0)
    expect(ev('roll(4)')).toBe(4)
  })
  it('concatenates strings with +', () => {
    expect(ev("'a' + 'b'")).toBe('ab')
    expect(ev("'hp ' + 3")).toBe('hp 3')
  })
})

describe('identifiers', () => {
  const scope = { str: { current: 9, max: 12 }, hp: 4, name: 'Pip', inventory: [{ name: 'Needle', damage: 'd6' }] }
  it('resolves dotted paths and array indices', () => {
    expect(ev('str.current + 1', scope)).toBe(10)
    expect(ev('str.max', scope)).toBe(12)
    expect(ev('inventory.0.name', scope)).toBe('Needle')
    expect(ev("name == 'Pip'", scope)).toBe(true)
  })
  it('errors on unknown identifiers and non-values', () => {
    expect(() => ev('nope', scope)).toThrow(/unknown identifier "nope"/)
    expect(() => ev('str.nope', scope)).toThrow(/unknown identifier/)
    expect(() => ev('str', scope)).toThrow(/not a value/)
  })
  it('composes named sub-scopes', () => {
    const s = composeScope({ target: objectScope({ hp: 2 }), rolls: { power: { total: 7 } } }, objectScope(scope))
    expect(evaluateSync('target.hp + rolls.power.total + hp', s)).toBe(13)
  })
})

describe('errors', () => {
  it('rejects malformed expressions', () => {
    for (const bad of ['', '1 +', '(1 + 2', '1 2', 'floor(', 'a ? b', '1 < 2 < 3', 'and 1', 'floor 1', 'x.']) {
      expect(() => parse(bad), bad).toThrow(ExprError)
    }
  })
  it('rejects bad types at evaluation', () => {
    expect(() => ev("'a' - 1")).toThrow(/expects a number/)
    expect(() => ev('1 / 0')).toThrow(/division by zero/)
    expect(() => ev('floor(1, 2)')).toThrow(/takes 1 argument/)
    expect(() => ev('unknown(1)')).toThrow(/unknown function/)
    expect(() => ev('roll(true)')).toThrow(/dice formula/)
  })
  it('refuses dice when evaluating synchronously', () => {
    expect(() => ev('d20')).toThrow(/dice are not allowed/)
    expect(usesDice(parse('d20 + 1'))).toBe(true)
    expect(usesDice(parse("roll('d6')"))).toBe(true)
    expect(usesDice(parse('1 + 2'))).toBe(false)
  })
})

describe('dice', () => {
  it('derives the same values as fair.ts, in left-to-right order', async () => {
    const stream = new DiceStream(seed)
    const total = await evaluate('2d6 + d20', objectScope({}), stream)
    const fair = await diceFromSeed(parseFormula('2d6 + d20'), seed)
    expect(stream.dice).toEqual(fair)
    expect(total).toBe(fair.reduce((a, d) => a + d.value, 0))
  })
  it('is deterministic per seed and differs across seeds', async () => {
    const a = await evaluate('4d6kh3 + 2d8', objectScope({}), new DiceStream(seed))
    const b = await evaluate('4d6kh3 + 2d8', objectScope({}), new DiceStream(seed))
    expect(a).toBe(b)
    const others = await Promise.all(['cd'.repeat(32), 'ef'.repeat(32), '12'.repeat(32)].map((s) => evaluate('10d20', objectScope({}), new DiceStream(s))))
    expect(others.some((o) => o !== (a as number))).toBe(true)
  })
  it('reads d66 as two d6, tens then ones, like fair.ts', async () => {
    const stream = new DiceStream(seed)
    const total = await evaluate('d66', objectScope({}), stream)
    expect(stream.dice).toHaveLength(2)
    expect(stream.dice.every((d) => d.sides === 6)).toBe(true)
    expect(total).toBe(stream.dice[0].value * 10 + stream.dice[1].value)
    expect(total).toBe((await rollFromSeed('d66', seed)).total)
  })
  it('applies keep-highest', async () => {
    const stream = new DiceStream(seed)
    const total = await evaluate('4d6kh3', objectScope({}), stream)
    const values = stream.dice.map((d) => d.value).sort((x, y) => y - x)
    expect(total).toBe(values[0] + values[1] + values[2])
  })
  it('continues the stream across expressions', async () => {
    const stream = new DiceStream(seed)
    const first = await evaluate('d20', objectScope({}), stream)
    const second = await evaluate('d20', objectScope({}), stream)
    const fair = await diceFromSeed(parseFormula('2d20'), seed)
    expect([first, second]).toEqual(fair.map((d) => d.value))
    expect(stream.dice).toHaveLength(2)
  })
  it('rolls formulas held in strings and from scope', async () => {
    const stream = new DiceStream(seed)
    const total = await evaluate("roll(weapon.damage) + roll('d4')", objectScope({ weapon: { damage: '2d6+1' } }), stream)
    const fair = await diceFromSeed(parseFormula('2d6 + d4'), seed)
    expect(stream.dice.map((d) => d.sides)).toEqual([6, 6, 4])
    expect(total).toBe(fair.reduce((a, d) => a + d.value, 0) + 1)
  })
  it('only consumes dice on the branch taken', async () => {
    const stream = new DiceStream(seed)
    await evaluate('true ? d6 : d20', objectScope({}), stream)
    expect(stream.dice.map((d) => d.sides)).toEqual([6])
  })
  it('does not commit dice when evaluation fails', async () => {
    const stream = new DiceStream(seed)
    await expect(evaluate('d6 + nope', objectScope({}), stream)).rejects.toThrow(/unknown identifier/)
    expect(stream.dice).toHaveLength(0)
  })
})

describe('setPath', () => {
  it('creates intermediate objects and arrays', () => {
    const o: Record<string, unknown> = {}
    setPath(o, ['a', 'b'], 1)
    setPath(o, ['list', '0', 'x'], 2)
    expect(o).toEqual({ a: { b: 1 }, list: [{ x: 2 }] })
  })
})
