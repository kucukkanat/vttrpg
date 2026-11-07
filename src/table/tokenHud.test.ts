import { describe, expect, it } from 'vitest'
import type { ConditionDef, ResourceDef } from '@/core/pack'
import { CATEGORY_COLORS, chipAngle, chipLabel, conditionCategory, conditionChips, conditionTurns, hpBand, hpState, MAX_PIPS, readResource, UNKNOWN_CONDITION_COLOR } from './tokenHud'

const hp: ResourceDef = { id: 'hp', name: 'Hit Protection', max: 'hp.max' }
const defs: ConditionDef[] = [
  { id: 'exhausted', name: 'Exhausted', description: '', icon: 'zzz', category: 'affliction' },
  { id: 'frightened', name: 'Frightened', description: '', icon: 'not-a-glyph' },
  { id: 'shield-of-faith', name: 'Shield of Faith', description: '', icon: 'shield', category: 'buff' },
]

describe('readResource', () => {
  it('reads a { current, max } sheet resource', () => {
    expect(readResource({ hp: { current: 3, max: 6 } }, hp)).toEqual({ current: 3, max: 6 })
  })
  it('falls back to the pack expression for a bare number', () => {
    expect(readResource({ hp: 4 }, hp, () => 10)).toEqual({ current: 4, max: 10 })
  })
  it('hides the bar when the sheet does not track the resource or the max is unknown', () => {
    expect(readResource({}, hp)).toBeNull()
    expect(readResource({ hp: 4 }, hp)).toBeNull()
    expect(readResource({ hp: { current: 4 } }, hp, () => { throw new Error('dice') })).toBeNull()
    expect(readResource({ hp: { current: 4, max: 0 } }, hp)).toBeNull()
    expect(readResource({ hp: { current: 4, max: 6 } }, undefined)).toBeNull()
  })
  it('clamps a negative current to zero', () => {
    expect(readResource({ hp: { current: -2, max: 6 } }, hp)).toEqual({ current: 0, max: 6 })
  })
})

describe('hpBand', () => {
  it('bands at half and a quarter', () => {
    expect(hpBand(6, 6)).toBe('high')
    expect(hpBand(4, 6)).toBe('high')
    expect(hpBand(3, 6)).toBe('mid')
    expect(hpBand(2, 6)).toBe('mid')
    expect(hpBand(1, 6)).toBe('low')
    expect(hpBand(0, 6)).toBe('low')
    expect(hpBand(1, 0)).toBe('low')
  })
  it('marks bloodied at half or less and down at zero', () => {
    expect(hpState(4, 6)).toBeNull()
    expect(hpState(3, 6)).toBe('bloodied')
    expect(hpState(0, 6)).toBe('down')
    expect(hpState(0, 0)).toBeNull()
  })
  it('keeps pips for short bars only', () => {
    expect(MAX_PIPS).toBeGreaterThanOrEqual(6)
  })
})

describe('condition chips', () => {
  it('labels with two letters: one word or initials', () => {
    expect(chipLabel('Injured')).toBe('IN')
    expect(chipLabel('Shield of Faith')).toBe('SF')
    expect(chipLabel('eye-off')).toBe('EO')
    expect(chipLabel('')).toBe('?')
  })
  it('merges token and sheet conditions without duplicates, in order', () => {
    const chips = conditionChips({ conditions: ['frightened'] }, { data: { conditions: ['exhausted', 'frightened'] } }, defs)
    expect(chips.map((c) => c.id)).toEqual(['frightened', 'exhausted'])
    // No category in the pack: guessed from the name. An icon name without a drawing falls back to letters.
    expect(chips[0]).toMatchObject({ label: 'FR', name: 'Frightened', category: 'control', shape: 'square', glyph: null, color: CATEGORY_COLORS.control })
    expect(chips[1]).toMatchObject({ label: 'EX', category: 'affliction', shape: 'diamond', glyph: 'zzz', color: CATEGORY_COLORS.affliction })
  })
  it('keeps unknown ids as grey chips and ignores non-strings', () => {
    const chips = conditionChips({ conditions: ['stunned', '' as string] }, { data: { conditions: [3, null] } }, defs)
    expect(chips).toEqual([{
      id: 'stunned', label: 'ST', name: 'stunned', color: UNKNOWN_CONDITION_COLOR, category: 'control', shape: 'square', glyph: null, turns: null, last: false,
    }])
  })
  it('defaults to harm and honours the pack category', () => {
    expect(conditionCategory('mystery', undefined)).toBe('harm')
    expect(conditionCategory('stunned', { category: 'buff' })).toBe('buff')
  })
  it('reads turns left from whatever duration data is present, and tolerates none', () => {
    const token = { conditions: ['frightened', { id: 'exhausted', turns: 1 }] as unknown as string[], conditionDurations: { frightened: { remaining: 3 } } }
    const chips = conditionChips(token, undefined, defs)
    expect(chips.map((c) => [c.id, c.turns, c.last])).toEqual([['frightened', 3, false], ['exhausted', 1, true]])
    expect([...conditionTurns({ conditions: ['x'] }, { data: { durations: { x: 2, y: 'soon', z: -1 } } })]).toEqual([['x', 2]])
    expect(conditionTurns({ conditions: [] }, undefined).size).toBe(0)
  })
  it('is empty without conditions or a sheet', () => {
    expect(conditionChips({ conditions: [] }, undefined, defs)).toEqual([])
  })
  it('spaces chips 40 degrees apart from the upper right', () => {
    expect(chipAngle(0)).toBeCloseTo(Math.PI / 4)
    expect(chipAngle(1)).toBeCloseTo(Math.PI / 4 - (40 * Math.PI) / 180)
  })
})
