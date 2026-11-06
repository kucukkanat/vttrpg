import { describe, expect, it } from 'vitest'
import { FILTER_THRESHOLD, filterTokens } from './TokensPanel'

const names = (list: { name: string }[]) => list.map((t) => t.name)

describe('filterTokens', () => {
  const tokens = [{ name: 'Clover Quickpaw' }, { name: 'Rat 1' }, { name: 'rat 2' }, { name: 'Brute' }]

  it('matches case-insensitively anywhere in the name', () => {
    expect(names(filterTokens(tokens, 'rat'))).toEqual(['Rat 1', 'rat 2'])
    expect(names(filterTokens(tokens, 'QUICK'))).toEqual(['Clover Quickpaw'])
  })

  it('keeps everything for an empty or blank needle', () => {
    expect(filterTokens(tokens, '')).toHaveLength(4)
    expect(filterTokens(tokens, '   ')).toHaveLength(4)
  })

  it('shows the filter only above fifteen rows', () => {
    expect(FILTER_THRESHOLD).toBe(15)
  })
})
