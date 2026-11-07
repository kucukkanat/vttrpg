import { describe, expect, it } from 'vitest'
import { atZoomLimit, nearestEquivalent, nearestTurn, orbitMaxDistance, tacticalTheta, topDownDistance, wrapAngle } from './tactical'

describe('tactical headings', () => {
  it('turns in 45° steps, wrapped to (-PI, PI]', () => {
    expect(tacticalTheta(0)).toBe(0)
    expect(tacticalTheta(2)).toBeCloseTo(Math.PI / 2)
    expect(tacticalTheta(4)).toBeCloseTo(Math.PI)
    expect(tacticalTheta(5)).toBeCloseTo(-3 * Math.PI / 4)
    expect(tacticalTheta(-1)).toBeCloseTo(-Math.PI / 4)
    expect(tacticalTheta(8)).toBeCloseTo(0)
  })

  it('enters at the step nearest the current heading', () => {
    expect(nearestTurn(0.3)).toBe(0)
    expect(nearestTurn(0.5)).toBe(1)
    expect(nearestTurn(-2.0)).toBe(-3)
  })

  it('animates the short way round', () => {
    expect(nearestEquivalent(3, -3)).toBeCloseTo(2 * Math.PI - 3)
    expect(nearestEquivalent(-3, 3)).toBeCloseTo(-(2 * Math.PI - 3))
    expect(nearestEquivalent(0.2, 0.5)).toBeCloseTo(0.5)
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI)
  })
})

describe('tactical distances', () => {
  it('keeps the orbit limit between ten cells and 80 m', () => {
    expect(orbitMaxDistance(5, 1.5)).toBe(15)
    expect(orbitMaxDistance(30, 1.5)).toBeCloseTo(42)
    expect(orbitMaxDistance(100, 1.5)).toBe(80)
  })

  it('frames the floor from straight above along the narrower field of view', () => {
    const vfov = (50 * Math.PI) / 180
    const wide = topDownDistance(20, 10, vfov, 2)
    const tall = topDownDistance(20, 10, vfov, 0.5)
    expect(wide).toBeCloseTo((10 / Math.tan(vfov / 2)) * 1.08)
    expect(tall).toBeGreaterThan(wide)
  })

  it('counts a zoom within 2 % of the limit as pushing against it', () => {
    expect(atZoomLimit(39.3, 40)).toBe(true)
    expect(atZoomLimit(38, 40)).toBe(false)
  })
})
