import { describe, expect, it } from 'vitest'
import type { Token } from '@/core/doc'
import type { SceneId, TokenId } from '@/core/ids'
import { DAMAGE_COLOR, formatDelta, HEAL_COLOR, NUMBER_DELAY_MS, NUMBER_STAGGER_MS, planNumbers, resourceTag } from './numbers'
import { CHEST_HEIGHT_CELLS, type VfxEvent } from './schedule'

const scene = 's1' as SceneId
const A = 'a' as TokenId
const B = 'b' as TokenId
const token = (id: TokenId, x: number, scale = 1, elevation?: number): Token => ({
  id, scene, name: id, color: '#fff', position: { x, y: 0, z: 0 }, rotationY: 0, scale, elevation, vision: 0, light: 0, hidden: false, conditions: [],
})
const tokens = { [A]: token(A, -2), [B]: token(B, 3, 2, 1) }
const event = (numbers: VfxEvent['numbers']): VfxEvent => ({ id: 'e1', at: 0, kind: 'vfx', cues: [], scene, source: A, targets: [B], numbers })

describe('formatDelta / resourceTag', () => {
  it('signs and rounds', () => {
    expect(formatDelta(-3)).toBe('-3')
    expect(formatDelta(2)).toBe('+2')
    expect(formatDelta(-2.6)).toBe('-3')
  })
  it('shortens resource keys to a tag', () => {
    expect(resourceTag('hp')).toBe('hp')
    expect(resourceTag('hp.current')).toBe('hp')
    expect(resourceTag('resources.slots_1')).toBe('slots_')
  })
})

describe('planNumbers', () => {
  it('places a number above each token, red for damage and green for healing', () => {
    const cell = 1.5
    const out = planNumbers(event([{ token: B, delta: -4, resource: 'hp' }, { token: A, delta: 2, resource: 'hp' }]), tokens, cell, 1000)
    expect(out).toHaveLength(2)
    const b = out.find((n) => n.key === 'e1:n:0')!
    expect(b.color).toBe(DAMAGE_COLOR)
    expect(b.position.x).toBe(3)
    // Head height scales with the token and includes its elevation.
    expect(b.position.y).toBeCloseTo((CHEST_HEIGHT_CELLS * 2 + 0.1) * cell * 2 + 1)
    expect(b.fireAt).toBe(1000 + NUMBER_DELAY_MS)
    const a = out.find((n) => n.key === 'e1:n:1')!
    expect(a.color).toBe(HEAL_COLOR)
    expect(a.delta).toBe(2)
  })
  it('staggers several numbers on the same token and keeps them sorted by time', () => {
    const out = planNumbers(event([{ token: B, delta: -4, resource: 'hp' }, { token: B, delta: -1, resource: 'wil' }]), tokens, 1, 0)
    expect(out.map((n) => n.fireAt)).toEqual([NUMBER_DELAY_MS, NUMBER_DELAY_MS + NUMBER_STAGGER_MS])
    expect(out[1]!.resource).toBe('wil')
  })
  it('skips zero deltas, missing tokens and events without numbers', () => {
    expect(planNumbers(event([{ token: B, delta: 0, resource: 'hp' }, { token: 'ghost' as TokenId, delta: -2, resource: 'hp' }]), tokens, 1, 0)).toEqual([])
    expect(planNumbers(event(undefined), tokens, 1, 0)).toEqual([])
  })
})
