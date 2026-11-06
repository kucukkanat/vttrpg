import { describe, expect, it } from 'vitest'
import { titleCase } from './library'

describe('titleCase', () => {
  it('turns a library file name into a readable scene name', () => {
    expect(titleCase('forest-clearing.glb')).toBe('Forest clearing')
    expect(titleCase('dungeon')).toBe('Dungeon')
    expect(titleCase('old_mill__ruins.GLB')).toBe('Old mill ruins')
    expect(titleCase('tavern.png')).toBe('Tavern')
  })
  it('leaves names that already have capitals alone', () => {
    expect(titleCase('Old Mill.glb')).toBe('Old Mill')
    expect(titleCase('Crypt of St Agnes')).toBe('Crypt of St Agnes')
  })
  it('does not blank out odd inputs', () => {
    expect(titleCase('.glb')).toBe('.glb')
    expect(titleCase('')).toBe('')
  })
})
