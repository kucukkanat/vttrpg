import { describe, expect, it } from 'vitest'
import { setDataPath } from './sheetEdit'

describe('setDataPath', () => {
  it('sets nested object paths without touching the original', () => {
    const data = { hp: { current: 3, max: 5 }, name: 'x' }
    const next = setDataPath(data, 'hp.current', 4)
    expect(next).toEqual({ hp: { current: 4, max: 5 }, name: 'x' })
    expect(data.hp.current).toBe(3)
  })
  it('keeps lists as lists when an item field is edited', () => {
    const data = { actions: [{ name: 'Bite', bonus: 4 }, { name: 'Claw', bonus: 4 }] }
    const next = setDataPath(data, 'actions.1.bonus', 6)
    expect(Array.isArray(next.actions)).toBe(true)
    expect(next.actions).toEqual([{ name: 'Bite', bonus: 4 }, { name: 'Claw', bonus: 6 }])
    expect(data.actions[1]!.bonus).toBe(4)
  })
})
