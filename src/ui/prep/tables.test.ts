import { describe, expect, it } from 'vitest'
import { describeRow, formatTableRoll, lookupRow, tableTitle } from './tables'

describe('lookupRow', () => {
  const rows = { '1': 'one', '2-3': 'two-three', '11': 'eleven' }
  it('prefers exact keys', () => { expect(lookupRow(rows, '11')).toBe('eleven') })
  it('falls back to range keys', () => { expect(lookupRow(rows, '3')).toBe('two-three') })
  it('returns undefined when nothing matches', () => { expect(lookupRow(rows, '9')).toBeUndefined(); expect(lookupRow(rows, 'x')).toBeUndefined() })
})

describe('describeRow', () => {
  it('flattens strings, numbers, nested objects and item names', () => {
    expect(describeRow({ background: 'Grain counter', items: [{ name: 'Abacus' }, { name: 'Sack of grain', usage: 3 }], coat: { color: 'Ash grey' }, speed_base: 25 }))
      .toBe('background: Grain counter; items: Abacus, Sack of grain; coat.color: Ash grey; speed_base: 25')
  })
  it('lists plain string arrays', () => {
    expect(describeRow({ features: ['Darkvision', 'Resilience'] })).toBe('features: Darkvision, Resilience')
  })
})

describe('formatting', () => {
  it('titles table ids', () => { expect(tableTitle('coat-color')).toBe('Coat color') })
  it('formats a roll with and without a row', () => {
    expect(formatTableRoll({ table: 'birthsign', die: 'd6', key: '2', row: { birthsign: 'The Lantern' } })).toBe('Birthsign (d6 = 2): birthsign: The Lantern')
    expect(formatTableRoll({ table: 'birthsign', die: 'd6', key: '7', row: null })).toBe('Birthsign (d6 = 7): no entry')
  })
})
