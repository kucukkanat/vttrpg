import { describe, expect, it } from 'vitest'
import { FLARE_MS, FLARE_RADII, flareAt } from './turnFlare'

describe('flareAt', () => {
  it('bursts outward from the footprint while fading, then ends', () => {
    const start = flareAt(0)!
    const mid = flareAt(FLARE_MS / 2)!
    const late = flareAt(FLARE_MS - 1)!
    expect(start.scale).toBe(1)
    expect(mid.scale).toBeGreaterThan(start.scale)
    expect(late.scale).toBeGreaterThan(mid.scale)
    expect(late.scale).toBeLessThanOrEqual(FLARE_RADII)
    expect(mid.opacity).toBeLessThan(start.opacity)
    expect(late.opacity).toBeLessThan(0.05)
    expect(flareAt(FLARE_MS)).toBeNull()
    expect(flareAt(-1)).toBeNull()
  })
})
