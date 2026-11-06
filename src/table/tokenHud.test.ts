import { describe, expect, it } from 'vitest'
import type { ConditionDef, ResourceDef } from '@/core/pack'
import { chipAngle, chipLabel, conditionChips, CONDITION_PALETTE, hpBand, MAX_PIPS, readResource, UNKNOWN_CONDITION_COLOR } from './tokenHud'

const hp: ResourceDef = { id: 'hp', name: 'Hit Protection', max: 'hp.max' }
const defs: ConditionDef[] = [
  { id: 'exhausted', name: 'Exhausted', description: '' },
  { id: 'frightened', name: 'Frightened', description: '' },
  { id: 'shield-of-faith', name: 'Shield of Faith', description: '' },
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
    expect(chips[0]).toMatchObject({ label: 'FR', name: 'Frightened', color: CONDITION_PALETTE[1] })
    expect(chips[1]).toMatchObject({ label: 'EX', color: CONDITION_PALETTE[0] })
  })
  it('keeps unknown ids as grey chips and ignores non-strings', () => {
    const chips = conditionChips({ conditions: ['stunned', '' as string] }, { data: { conditions: [3, null] } }, defs)
    expect(chips).toEqual([{ id: 'stunned', label: 'ST', name: 'stunned', color: UNKNOWN_CONDITION_COLOR }])
  })
  it('is empty without conditions or a sheet', () => {
    expect(conditionChips({ conditions: [] }, undefined, defs)).toEqual([])
  })
  it('spaces chips 40 degrees apart from the upper right', () => {
    expect(chipAngle(0)).toBeCloseTo(Math.PI / 4)
    expect(chipAngle(1)).toBeCloseTo(Math.PI / 4 - (40 * Math.PI) / 180)
  })
})
