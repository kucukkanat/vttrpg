import { describe, expect, it } from 'vitest'
import { applyFieldExpr, evalExpr } from './expr'

describe('evalExpr', () => {
  it('evaluates arithmetic with precedence, parentheses and signs', () => {
    expect(evalExpr('1.5*2')).toBe(3)
    expect(evalExpr('1 + 2 * 3')).toBe(7)
    expect(evalExpr('(1 + 2) * 3')).toBe(9)
    expect(evalExpr('-3')).toBe(-3)
    expect(evalExpr('--3')).toBe(3)
    expect(evalExpr('2*-1.5')).toBe(-3)
    expect(evalExpr('10/4')).toBe(2.5)
    expect(evalExpr('.5')).toBe(0.5)
    expect(evalExpr('1,5')).toBe(1.5)
    expect(evalExpr('1e2')).toBe(100)
    expect(evalExpr('8 - 2 - 1')).toBe(5)
  })
  it('refuses anything that is not plain arithmetic', () => {
    for (const bad of ['', '1+', '(1', '1)', 'abc', 'alert(1)', '1/0', '2**3', 'Math.PI', '1 2', '0x10']) expect(evalExpr(bad)).toBeNull()
    expect(evalExpr('('.repeat(90) + '1' + ')'.repeat(90))).toBeNull()
    expect(evalExpr('1'.repeat(300))).toBeNull()
  })
})

describe('applyFieldExpr', () => {
  it('treats + * / prefixes as relative to the current value', () => {
    expect(applyFieldExpr('+0.5', 2)).toBe(2.5)
    expect(applyFieldExpr('+-1', 2)).toBe(1)
    expect(applyFieldExpr('*2', 1.5)).toBe(3)
    expect(applyFieldExpr('/4', 2)).toBe(0.5)
  })
  it('anything else is absolute', () => {
    expect(applyFieldExpr('1.5*2', 9)).toBe(3)
    expect(applyFieldExpr('-1', 9)).toBe(-1)
    expect(applyFieldExpr('nope', 9)).toBeNull()
    expect(applyFieldExpr('/0', 9)).toBeNull()
  })
})
