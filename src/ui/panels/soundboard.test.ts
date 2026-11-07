import { describe, expect, it } from 'vitest'
import { PAD_VOLUME_MAX, clampPadVolume, padVolume, parsePadVolumes } from './soundboard'

describe('pad volumes', () => {
  it('parses saved volumes, dropping junk and clamping', () => {
    expect(parsePadVolumes(null)).toEqual({})
    expect(parsePadVolumes('nope')).toEqual({})
    expect(parsePadVolumes('[1,2]')).toEqual({})
    expect(parsePadVolumes(JSON.stringify({ 'builtin:drum': 0.4, a: 'x', b: 9, c: -1 }))).toEqual({ 'builtin:drum': 0.4, b: PAD_VOLUME_MAX, c: 0 })
  })
  it('defaults a pad to 100% and clamps non-finite input to it', () => {
    expect(padVolume({}, 'k')).toBe(1)
    expect(padVolume({ k: 0.2 }, 'k')).toBe(0.2)
    expect(clampPadVolume(Number.NaN)).toBe(1)
  })
})
