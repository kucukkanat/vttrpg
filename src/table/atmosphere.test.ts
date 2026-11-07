import { describe, expect, it } from 'vitest'
import { ambientLevels, blobShadowLook, fogColor, fogRange } from './atmosphere'

describe('fogColor', () => {
  it('runs from dusk blue-grey to deep indigo', () => {
    expect(fogColor(0)).toBe('#343644')
    expect(fogColor(1)).toBe('#12121c')
    expect(fogColor(5)).toBe('#12121c')
    expect(fogColor(Number.NaN)).toBe('#343644')
  })

  it('keeps blue above red so the fog stays cool against warm lights', () => {
    for (const d of [0, 0.3, 0.7, 1]) {
      const c = fogColor(d)
      expect(parseInt(c.slice(5, 7), 16)).toBeGreaterThan(parseInt(c.slice(1, 3), 16))
    }
  })
})

describe('fogRange', () => {
  it('starts past the point the camera looks at and fades over the far side', () => {
    const { near, far } = fogRange(20, 10)
    expect(near).toBeGreaterThan(20)
    expect(far - near).toBeCloseTo(22)
  })

  it('never fogs the first few metres', () => {
    expect(fogRange(0.5, 2).near).toBe(6)
  })
})

describe('ambientLevels', () => {
  it('raises the floor of dark scenes and grows with light', () => {
    const dark = ambientLevels(1)
    const lit = ambientLevels(0)
    expect(dark.ambient).toBeGreaterThanOrEqual(0.25)
    expect(dark.hemisphere).toBeGreaterThanOrEqual(0.2)
    expect(lit.ambient).toBeGreaterThan(dark.ambient)
  })
})

describe('blobShadowLook', () => {
  it('is darkest on the floor and fades but stays as the token rises', () => {
    const floor = blobShadowLook(0, 1.5)
    const up = blobShadowLook(4.5, 1.5)
    const sky = blobShadowLook(100, 1.5)
    expect(floor.opacity).toBeCloseTo(0.55)
    expect(up.opacity).toBeLessThan(floor.opacity)
    expect(up.scale).toBeGreaterThan(floor.scale)
    expect(sky.opacity).toBeGreaterThan(0)
  })
})
