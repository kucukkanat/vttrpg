import { describe, expect, it } from 'vitest'
import type { GameEvent, Token } from '@/core/doc'
import type { AssetHash, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import type { VfxCue } from '@/core/pack'
import { createVfxBus } from './bus'
import {
  CHEST_HEIGHT_CELLS, DEFAULT_RING_CELLS, PRESET_DEFAULTS, planEvent, prunePlayed, resolveAnchor, ringRadius, shakeStrength,
  splitDue, takeNewEvents, type VfxEvent,
} from './schedule'

const SCENE = 'scene-1' as SceneId
const A = 'tok-a' as TokenId
const B = 'tok-b' as TokenId
const C = 'tok-c' as TokenId
const CELL = 1.5

function token(id: TokenId, x: number, z: number, scale = 1): Token {
  return { id, scene: SCENE, name: id, color: '#fff', position: { x, y: 0, z }, rotationY: 0, scale, vision: 0, light: 0, hidden: false, conditions: [] }
}
const tokens = { [A]: token(A, -3, 2), [B]: token(B, 3, -2), [C]: token(C, 0, 0, 2) } as Record<TokenId, Token>

function vfx(id: string, at: number, cues: VfxCue[], extra: Partial<VfxEvent> = {}): VfxEvent {
  return { id, at, kind: 'vfx', cues, scene: SCENE, source: A, targets: [B], ...extra }
}
const audio: GameEvent = {
  id: 'audio-1', at: 50, kind: 'audio', by: 'gm'.padEnd(64, '0') as PlayerPubkey,
  asset: { sha256: 'x' as AssetHash, kind: 'audio', mime: 'audio/ogg', size: 1, sources: [] },
}

describe('takeNewEvents', () => {
  it('returns vfx events once, skipping audio and events older than since', () => {
    const played = new Set<string>()
    const events: GameEvent[] = [vfx('old', 10, []), audio, vfx('e1', 100, []), vfx('e2', 200, [])]
    const first = takeNewEvents(events, 100, played)
    expect(first.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(takeNewEvents(events, 100, played)).toEqual([])
    expect(played.has('old')).toBe(false)
    const more = takeNewEvents([...events, vfx('e3', 300, [])], 100, played)
    expect(more.map((e) => e.id)).toEqual(['e3'])
  })

  it('prunes played ids that left the doc', () => {
    const played = new Set(['gone', 'kept'])
    prunePlayed([vfx('kept', 1, [])], played)
    expect([...played]).toEqual(['kept'])
  })
})

describe('resolveAnchor', () => {
  const ev = { source: A, targets: [B], point: { x: 1, y: 0.5, z: 1 } }

  it('lifts token anchors to chest height scaled by the token', () => {
    const a = resolveAnchor('source', ev, tokens, CELL)!
    expect(a.ground).toEqual({ x: -3, y: 0, z: 2 })
    expect(a.chest).toEqual({ x: -3, y: CHEST_HEIGHT_CELLS * CELL, z: 2 })
    const big = resolveAnchor('target', { ...ev, targets: [C] }, tokens, CELL)!
    expect(big.chest.y).toBeCloseTo(CHEST_HEIGHT_CELLS * CELL * 2)
  })

  it('resolves a specific target id and the point', () => {
    expect(resolveAnchor('target', { ...ev, targets: [B, A] }, tokens, CELL, A)!.ground.x).toBe(-3)
    const p = resolveAnchor('point', ev, tokens, CELL)!
    expect(p.ground).toEqual({ x: 1, y: 0.5, z: 1 })
    expect(p.chest.y).toBeCloseTo(0.5 + CHEST_HEIGHT_CELLS * CELL)
  })

  it('falls back between target and point, and returns null when nothing resolves', () => {
    expect(resolveAnchor('target', { source: A, targets: [], point: { x: 1, y: 0, z: 1 } }, tokens, CELL)!.ground.x).toBe(1)
    expect(resolveAnchor('point', { source: A, targets: [B] }, tokens, CELL)!.ground.x).toBe(3)
    expect(resolveAnchor('target', { source: A, targets: ['missing' as TokenId] }, tokens, CELL)).toBeNull()
    expect(resolveAnchor('source', { targets: [B] }, tokens, CELL)).toBeNull()
    expect(resolveAnchor('point', { targets: [] }, tokens, CELL)).toBeNull()
  })
})

describe('planEvent', () => {
  const fireball: VfxCue[] = [
    { at: 0, preset: 'projectile', from: 'source', to: 'point', color: '#ff7a1a', duration: 400 },
    { at: 400, preset: 'ring', from: 'point', color: '#ff4500', duration: 700 },
    { at: 400, preset: 'shake', duration: 300 },
    { at: 450, preset: 'hit', from: 'target', color: '#ffb347', duration: 300 },
    { at: 450, preset: 'sound', asset: 'boom.ogg' },
  ]

  it('schedules cues at now + offset in time order, expands target cues per target and drops sound', () => {
    const plan = planEvent(vfx('fb', 1000, fireball, { targets: [B, C], point: { x: 2, y: 0, z: -1 } }), tokens, CELL, 5000)
    expect(plan.map((p) => [p.preset, p.fireAt])).toEqual([
      ['projectile', 5000], ['ring', 5400], ['shake', 5400], ['hit', 5450], ['hit', 5450],
    ])
    expect(plan.map((p) => p.key)).toEqual(['fb:0:0', 'fb:1:0', 'fb:2:0', 'fb:3:0', 'fb:3:1'])
    const hits = plan.filter((p) => p.preset === 'hit')
    expect(hits[0].from!.ground.x).toBe(3)
    expect(hits[1].from!.ground.x).toBe(0)
    const proj = plan[0]
    expect(proj.from!.chest).toEqual({ x: -3, y: CHEST_HEIGHT_CELLS * CELL, z: 2 })
    expect(proj.to!.ground).toEqual({ x: 2, y: 0, z: -1 })
    expect(proj.color).toBe('#ff7a1a')
    expect(proj.duration).toBe(400)
    expect(plan.find((p) => p.preset === 'ring')!.radius).toBe(DEFAULT_RING_CELLS * CELL)
    expect(plan.find((p) => p.preset === 'shake')!.from).toBeNull()
  })

  it('uses preset defaults for missing color, duration and anchors', () => {
    const plan = planEvent(vfx('d', 0, [{ at: 0, preset: 'beam' }, { at: 10, preset: 'hit' }, { at: 20, preset: 'aura' }]), tokens, CELL, 0)
    expect(plan).toHaveLength(3)
    const [beam, hit, aura] = plan
    expect(beam.from!.ground.x).toBe(-3)
    expect(beam.to!.ground.x).toBe(3)
    expect(beam.color).toBe(PRESET_DEFAULTS.beam.color)
    expect(beam.duration).toBe(PRESET_DEFAULTS.beam.duration)
    expect(hit.from!.ground.x).toBe(3)
    expect(aura.duration).toBe(PRESET_DEFAULTS.aura.duration)
  })

  it('drops cues whose anchors cannot be resolved instead of throwing', () => {
    const plan = planEvent(
      vfx('x', 0, [{ at: 0, preset: 'beam' }, { at: 0, preset: 'hit' }, { at: 0, preset: 'shake' }], { source: undefined, targets: ['nope' as TokenId] }),
      tokens, CELL, 0,
    )
    expect(plan.map((p) => p.preset)).toEqual(['shake'])
  })

  it('runs a single instance when there are no targets but a point', () => {
    const plan = planEvent(vfx('p', 0, [{ at: 0, preset: 'ring', from: 'target' }], { targets: [], point: { x: 0, y: 0, z: 0 } }), tokens, CELL, 0)
    expect(plan).toHaveLength(1)
    expect(plan[0].from!.ground).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('reads optional radius and strength from the cue', () => {
    expect(ringRadius({ at: 0, preset: 'ring' }, 2)).toBe(4)
    expect(ringRadius({ at: 0, preset: 'ring', radius: 3 } as VfxCue, 2)).toBe(6)
    expect(shakeStrength({ at: 0, preset: 'shake' })).toBeGreaterThan(0)
    expect(shakeStrength({ at: 0, preset: 'shake', strength: 5 } as VfxCue)).toBe(1)
  })
})

describe('splitDue', () => {
  it('partitions by fire time and keeps order', () => {
    const list = [{ fireAt: 1, k: 'a' }, { fireAt: 5, k: 'b' }, { fireAt: 3, k: 'c' }, { fireAt: 9, k: 'd' }]
    const { due, pending } = splitDue(list, 3)
    expect(due.map((e) => e.k)).toEqual(['a', 'c'])
    expect(pending.map((e) => e.k)).toEqual(['b', 'd'])
    expect(splitDue(list, 0).due).toEqual([])
    expect(splitDue(list, 100).pending).toEqual([])
  })
})

describe('vfxBus', () => {
  it('delivers to subscribers until unsubscribed', () => {
    const bus = createVfxBus()
    const got: number[] = []
    const off = bus.on('shake', (s) => got.push(s))
    bus.emit('shake', 0.5, 300)
    expect(bus.count('shake')).toBe(1)
    off()
    bus.emit('shake', 0.9, 300)
    expect(got).toEqual([0.5])
    expect(bus.count('shake')).toBe(0)
  })
})
