import { afterEach, describe, expect, it } from 'vitest'
import { advanceClock, hitStopActive, requestHitStop, resetHitStop } from './hitStop'

describe('hit-stop', () => {
  afterEach(() => resetHitStop())

  it('holds effect clocks during the stop and lets them run after it', () => {
    expect(advanceClock(0.5, 0.016, 1000, 1050)).toBe(0.5)
    // A frame straddling the end only counts the part after it.
    expect(advanceClock(0.5, 0.016, 1058, 1050)).toBeCloseTo(0.508)
    expect(advanceClock(0.5, 0.016, 2000, 1050)).toBeCloseTo(0.516)
    expect(advanceClock(0.5, 0.016, 2000, 0)).toBeCloseTo(0.516)
  })
  it('extends a running stop but never shortens it', () => {
    requestHitStop(100, 1000)
    requestHitStop(20, 1010)
    expect(hitStopActive(1090)).toBe(true)
    expect(hitStopActive(1101)).toBe(false)
    requestHitStop(-5, 2000)
    expect(hitStopActive(2001)).toBe(false)
  })
})
