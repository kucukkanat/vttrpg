import { describe, expect, it } from 'vitest'
import { guessCategory, guessRealSize, pivotOffset, zUpToYUp } from './normalise'

describe('pivotOffset', () => {
  it('puts the bottom centre at the origin', () => {
    expect(pivotOffset([0, 0, 0], [2, 1, 4], 1)).toEqual([-1, 0, -2])
    expect(pivotOffset([-1, 3, -1], [1, 5, 1], 1)).toEqual([0, -3, 0])
  })
  it('scales the offset with the model', () => {
    expect(pivotOffset([100, 20, -40], [160, 80, 20], 0.01)).toEqual([-1.3, -0.2, 0.1].map((v) => expect.closeTo(v, 9)))
  })
})

describe('zUpToYUp', () => {
  it('turns a Z-up box so its height is on Y', () => {
    const { min, max } = zUpToYUp([0, 0, 0], [0.4, 0.3, 0.8])
    expect(max[1] - min[1]).toBeCloseTo(0.8)
    expect(max[2] - min[2]).toBeCloseTo(0.3)
  })
})

describe('guessRealSize', () => {
  it('keeps plausible metre-scale sources', () => {
    const g = guessRealSize([0.6, 0.9, 0.6], { category: 'furniture' })
    expect(g.scale).toBe(1)
    expect(g.reason).toBe('source')
  })

  it('detects centimetres and millimetres from the bounds', () => {
    expect(guessRealSize([60, 180, 40], { category: 'creature' })).toMatchObject({ scale: 0.01, reason: 'centimetres' })
    expect(guessRealSize([600, 750, 1200], { category: 'furniture' })).toMatchObject({ scale: 0.001, reason: 'millimetres' })
    // No category: anything over 50 units is not metres.
    expect(guessRealSize([90, 75, 120]).reason).toBe('centimetres')
    expect(guessRealSize([900, 750, 1200]).reason).toBe('millimetres')
  })

  it('treats STL as millimetres and offers creature size for miniatures', () => {
    expect(guessRealSize([400, 800, 300], { format: 'stl', category: 'structure' })).toMatchObject({ scale: 0.001, reason: 'millimetres' })
    const mini = guessRealSize([20, 32, 20], { format: 'stl' })
    expect(mini.reason).toBe('miniature')
    expect(mini.size[1]).toBeCloseTo(1.8)
  })

  it('uses a known real size when the provider publishes one', () => {
    const g = guessRealSize([2, 1.4, 1.6], { knownSize: [1.134, 0.706, 0.799] })
    expect(g.reason).toBe('known')
    expect(g.size[0]).toBeCloseTo(1.134)
  })

  it('falls back to the category size when no unit fits', () => {
    const g = guessRealSize([0.002, 0.004, 0.002], { category: 'furniture' })
    expect(g.reason).toBe('category')
    expect(Math.max(...g.size)).toBeCloseTo(1)
  })

  it('handles an empty model', () => {
    expect(guessRealSize([0, 0, 0]).size).toEqual([0, 0, 0])
  })
})

describe('guessCategory', () => {
  it('reads common words', () => {
    expect(guessCategory(['Old wooden chair'])).toBe('furniture')
    expect(guessCategory(['Barrel_01'])).toBe('container')
    expect(guessCategory(['dead tree trunk'])).toBe('nature')
    expect(guessCategory(['Goblin warrior'])).toBe('creature')
    expect(guessCategory(['xyz'])).toBeUndefined()
  })
})
