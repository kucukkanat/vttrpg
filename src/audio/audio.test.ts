import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRef } from '@/core/assets'
import type { GameEvent } from '@/core/doc'
import type { AssetHash, PlayerPubkey } from '@/core/ids'
import { createAudioEngine, STALE_ONE_SHOT_MS } from './impl'
import { builtinName, builtinRef, isBuiltin, ZERO_HASH } from './builtin'
import { pickNewAudioEvents } from './useGameAudio'
import { buildAmbience, AMBIENT_PRESETS } from './ambience'
import { asAudioContext, FakeAudioContext, FakeBuffer, FakeBufferSource, FakeGain } from './fakeAudioContext'

const ref = (hash: string, name = 'x.ogg'): AssetRef => ({ sha256: hash.padEnd(64, '0') as AssetHash, kind: 'audio', mime: 'audio/ogg', size: 10, name, sources: ['https://example.test/' + name] })

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m }
}

function setup(o: { state?: 'suspended' | 'running'; failResume?: boolean; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const ctx = new FakeAudioContext({ state: o.state, failResume: o.failResume })
  let now = 1_000_000
  const resolve = vi.fn(async (r: AssetRef) => r.sources[0])
  const storage = o.storage ?? memoryStorage()
  const engine = createAudioEngine({ resolve, createContext: () => asAudioContext(ctx), now: () => now, storage })
  return { ctx, engine, resolve, storage, setNow: (n: number) => { now = n }, now: () => now }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(64))))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('unlock', () => {
  it('starts locked on a suspended context, resumes and plays a silent buffer, then reports unlocked', async () => {
    const { ctx, engine } = setup()
    expect(engine.unlocked).toBe(false)
    const changes: boolean[] = []
    engine.subscribe(() => changes.push(engine.unlocked))
    await engine.unlock()
    expect(ctx.resumes).toBe(1)
    expect(engine.unlocked).toBe(true)
    expect(changes).toEqual([true])
    const silent = ctx.of<FakeBufferSource>('bufferSource').filter((s) => s.buffer?.length === 1)
    expect(silent).toHaveLength(1)
    expect(silent[0].started).toHaveLength(1)
  })

  it('stays locked when resume is refused (no gesture), and follows OS interruptions', async () => {
    const { ctx, engine } = setup({ failResume: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await engine.unlock()
    expect(engine.unlocked).toBe(false)
    warn.mockRestore()

    const { ctx: ctx2, engine: e2 } = setup({ state: 'running' })
    expect(e2.unlocked).toBe(true)
    ctx2.interrupt()
    expect(e2.unlocked).toBe(false)
    expect(ctx.state).toBe('suspended')
  })
})

describe('master volume', () => {
  it('reads the persisted value, clamps and writes back', () => {
    const storage = memoryStorage()
    storage.setItem('vttrpg.audio.volume', '0.3')
    const { engine, ctx } = setup({ storage })
    expect(engine.getMasterVolume()).toBe(0.3)
    engine.setMasterVolume(1.7)
    expect(engine.getMasterVolume()).toBe(1)
    expect(storage.map.get('vttrpg.audio.volume')).toBe('1')
    const master = ctx.of<FakeGain>('gain')[0]
    expect(master.gain.calls.at(-1)).toMatchObject({ method: 'setTargetAtTime', args: [1, 0, 0.02] })
  })

  it('defaults to 0.8 without storage', () => {
    const ctx = new FakeAudioContext()
    const engine = createAudioEngine({ resolve: async () => '', createContext: () => asAudioContext(ctx), storage: null })
    expect(engine.getMasterVolume()).toBe(0.8)
  })
})

describe('ambient crossfade', () => {
  it('fades the new loop in and the old one out over fadeMs, then stops the old source', async () => {
    vi.useFakeTimers()
    const { ctx, engine, resolve } = setup({ state: 'running' })
    ctx.currentTime = 10
    await engine.setAmbient(ref('a'), { fadeMs: 2000 })
    expect(resolve).toHaveBeenCalledTimes(1)
    const [srcA] = ctx.of<FakeBufferSource>('bufferSource')
    expect(srcA.loop).toBe(true)
    expect(srcA.started).toEqual([10])
    const gainA = srcA.connections[0] as FakeGain
    expect(gainA.gain.calls).toEqual([
      { method: 'setValueAtTime', args: [0, 10] },
      { method: 'linearRampToValueAtTime', args: [1, 12] },
    ])

    ctx.currentTime = 30
    await engine.setAmbient(ref('b'), { fadeMs: 1000, volume: 0.5 })
    const srcB = ctx.of<FakeBufferSource>('bufferSource')[1]
    const gainB = srcB.connections[0] as FakeGain
    expect(gainB.gain.calls).toEqual([
      { method: 'setValueAtTime', args: [0, 30] },
      { method: 'linearRampToValueAtTime', args: [0.5, 31] },
    ])
    expect(gainA.gain.calls.slice(2)).toEqual([
      { method: 'cancelScheduledValues', args: [30] },
      { method: 'setValueAtTime', args: [1, 30] },
      { method: 'linearRampToValueAtTime', args: [0, 31] },
    ])
    expect(srcA.stopped).toHaveLength(0)
    vi.advanceTimersByTime(1100)
    expect(srcA.stopped).toHaveLength(1)
    expect(srcB.stopped).toHaveLength(0)
  })

  it('is idempotent for the same asset, decodes each asset once, and fades to silence on undefined', async () => {
    vi.useFakeTimers()
    const { ctx, engine } = setup({ state: 'running' })
    await engine.setAmbient(ref('a'))
    await engine.setAmbient(ref('a'))
    expect(ctx.decoded).toBe(1)
    expect(ctx.of('bufferSource')).toHaveLength(1)
    await engine.setAmbient(undefined, { fadeMs: 500 })
    const src = ctx.of<FakeBufferSource>('bufferSource')[0]
    const g = src.connections[0] as FakeGain
    expect(g.gain.calls.at(-1)).toEqual({ method: 'linearRampToValueAtTime', args: [0, 0.5] })
    vi.advanceTimersByTime(600)
    expect(src.stopped).toHaveLength(1)
    await engine.setAmbient(ref('a'))
    expect(ctx.decoded).toBe(1)
  })

  it('drops a decode that was superseded by a later request', async () => {
    const { ctx, engine } = setup({ state: 'running' })
    let release!: (b: FakeBuffer) => void
    ctx.decodeAudioData = () => new Promise<FakeBuffer>((r) => { release = r })
    const p = engine.setAmbient(ref('slow'))
    await new Promise((r) => setTimeout(r, 0)) // resolve + fetch settle, decode is pending
    engine.setAmbientPreset('wind')
    release(ctx.createBuffer(1, 10, 48000))
    await p
    expect(ctx.of('bufferSource').filter((s) => (s as FakeBufferSource).buffer?.length === 10)).toHaveLength(0)
  })

  it('switches between presets with a crossfade and treats none as silence', () => {
    vi.useFakeTimers()
    const { ctx, engine } = setup({ state: 'running' })
    engine.setAmbientPreset('fire', { fadeMs: 1000 })
    const before = ctx.nodes.length
    engine.setAmbientPreset('fire')
    expect(ctx.nodes.length).toBe(before)
    ctx.currentTime = 5
    engine.setAmbientPreset('cave', { fadeMs: 1000 })
    expect(ctx.nodes.length).toBeGreaterThan(before)
    vi.advanceTimersByTime(1100)
    // fire's sources stopped, cave's still running
    const stoppedSources = ctx.of<FakeBufferSource>('bufferSource').filter((s) => s.stopped.length > 0)
    expect(stoppedSources.length).toBeGreaterThan(0)
    engine.setAmbientPreset('none')
    engine.setAmbientPreset(undefined)
    engine.dispose()
    vi.runOnlyPendingTimers()
  })

  it('builds every preset graph with a bounded node count and tears it down', () => {
    vi.useFakeTimers()
    for (const p of AMBIENT_PRESETS) {
      const ctx = new FakeAudioContext({ state: 'running' })
      const g = buildAmbience(asAudioContext(ctx), p)
      if (p === 'none') { expect(g).toBeNull(); continue }
      expect(g).not.toBeNull()
      expect(ctx.nodes.length).toBeLessThan(40)
      vi.advanceTimersByTime(3000)
      const detailNodes = ctx.nodes.length
      g!.stop()
      vi.advanceTimersByTime(10_000)
      expect(ctx.nodes.length).toBe(detailNodes) // scheduler stopped: nothing new
      expect((g!.output as unknown as FakeGain).disconnected).toBe(true)
    }
  })
})

describe('one-shots', () => {
  it('rejects events older than the stale window and plays fresh ones', async () => {
    const { ctx, engine, now } = setup({ state: 'running' })
    await engine.playOneShot(ref('old'), { at: now() - STALE_ONE_SHOT_MS - 1 })
    expect(ctx.decoded).toBe(0)
    await engine.playOneShot(ref('fresh'), { at: now() - 1000, volume: 0.5 })
    expect(ctx.decoded).toBe(1)
    const src = ctx.of<FakeBufferSource>('bufferSource')[0]
    expect(src.loop).toBe(false)
    expect(src.started).toHaveLength(1)
    expect((src.connections[0] as FakeGain).gain.value).toBe(0.5)
    await engine.playOneShot(ref('fresh'))
    expect(ctx.decoded).toBe(1)
  })

  it('synthesizes builtin: refs without resolving', async () => {
    const { ctx, engine, resolve } = setup({ state: 'running' })
    for (const name of ['door', 'sword', 'thunder', 'coin', 'scream', 'drum'] as const) {
      const before = ctx.nodes.length
      await engine.playOneShot(builtinRef(name))
      expect(ctx.nodes.length).toBeGreaterThan(before)
    }
    expect(resolve).not.toHaveBeenCalled()
    expect(ctx.decoded).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a builtin: ambient source maps onto the procedural preset of the same name', async () => {
    const { ctx, engine, resolve } = setup({ state: 'running' })
    await engine.setAmbient({ ...builtinRef('door'), sources: ['builtin:rain'] })
    expect(resolve).not.toHaveBeenCalled()
    expect(ctx.of('oscillator').length + ctx.of('bufferSource').length).toBeGreaterThan(0)
  })

  it('dice impacts synthesize and rate-limit simultaneous hits', () => {
    const { ctx, engine } = setup({ state: 'running' })
    engine.diceImpact(0.9)
    const n = ctx.nodes.length
    engine.diceImpact(0.9)
    expect(ctx.nodes.length).toBe(n)
    ctx.currentTime = 0.05
    engine.diceImpact(0.2)
    expect(ctx.nodes.length).toBeGreaterThan(n)
  })
})

describe('builtin refs', () => {
  it('round-trip through the builtin: scheme with a zero hash placeholder', () => {
    const r = builtinRef('coin')
    expect(r.sha256).toBe(ZERO_HASH)
    expect(r.sources).toEqual(['builtin:coin'])
    expect(builtinName(r)).toBe('coin')
    expect(isBuiltin(ref('a'))).toBe(false)
    expect(builtinName({ ...r, sources: ['builtin:nope'] })).toBeNull()
  })
})

describe('pickNewAudioEvents', () => {
  const by = 'gm' as PlayerPubkey
  const audio = (id: string, at: number): GameEvent => ({ id, at, kind: 'audio', asset: builtinRef('drum'), by })
  const vfx = (id: string, at: number): GameEvent => ({ id, at, kind: 'vfx', cues: [], scene: 's' as never, targets: [] })

  it('returns each audio event once, skips vfx and events before mount, prunes dropped ids', () => {
    const played = new Set<string>()
    const since = 1000
    let events = [audio('a', 900), vfx('v', 1500), audio('b', 1500)]
    expect(pickNewAudioEvents(events, played, since).map((e) => e.id)).toEqual(['b'])
    expect(pickNewAudioEvents(events, played, since)).toEqual([])
    events = [...events, audio('c', 1600)]
    expect(pickNewAudioEvents(events, played, since).map((e) => e.id)).toEqual(['c'])
    expect(played.has('a')).toBe(true) // stale ids are remembered so they are never re-evaluated
    events = [audio('c', 1600)] // GM pruned
    expect(pickNewAudioEvents(events, played, since)).toEqual([])
    expect([...played]).toEqual(['c'])
  })
})
