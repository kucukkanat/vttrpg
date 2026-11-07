import { describe, expect, it } from 'vitest'
import { adjustResource, saveChipLabel, sheetRolls, sheetSaves } from './tokenBar'

const schema = {
  sections: [
    { title: 'Stats', fields: [{ kind: 'resource', bind: 'str' }, { kind: 'roll', label: 'STR save', formula: 'd20 <= str' }, { kind: 'roll', label: 'STR check', formula: 'd20 + str' }] },
    { title: 'Gear', fields: [{ kind: 'list', item: [{ kind: 'roll', label: 'Save vs poison', formula: 'd20' }] }] },
  ],
}

describe('token bar helpers', () => {
  it('finds every roll in a sheet, nested ones included', () => {
    expect(sheetRolls(schema).map((r) => r.label)).toEqual(['STR save', 'STR check', 'Save vs poison'])
  })
  it('keeps only saves and shortens their labels', () => {
    expect(sheetSaves(schema).map((r) => saveChipLabel(r.label))).toEqual(['STR', 'Save vs poison'])
  })
  it('moves a resource within 0..max in either shape', () => {
    expect(adjustResource({ hp: { current: 2, max: 3 } }, 'hp', 5)).toEqual({ hp: { current: 3, max: 3 } })
    expect(adjustResource({ hp: { current: 1, max: 3 } }, 'hp', -4)).toEqual({ hp: { current: 0, max: 3 } })
    expect(adjustResource({ hp: 4 }, 'hp', -1, 6)).toEqual({ hp: 3 })
    expect(adjustResource({}, 'hp', 1)).toBeNull()
  })
})
