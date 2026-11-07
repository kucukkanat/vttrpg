import type { AssetRef } from '@/core/assets'
import type { AmbientPreset, AudioEngine } from './index'
import { AMBIENT_PRESETS, buildAmbience, type AmbienceGraph } from './ambience'
import { BUILTIN_DURATION_S, builtinName, soundKey } from './builtin'
import { SYNTHS, diceImpact as synthDiceImpact, turnChime as synthTurnChime } from './synth'

/** One-shots whose `at` is older than this are skipped (late joiners, replayed deltas). */
export const STALE_ONE_SHOT_MS = 5000
const VOLUME_KEY = 'vttrpg.audio.volume'
const DEFAULT_FADE_MS = 1500

export interface AudioEngineOptions {
  resolve(ref: AssetRef): Promise<string>
  /** Override for tests. Defaults to `new AudioContext()`. */
  createContext?: () => AudioContext
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
  /** Override for tests. Defaults to `window.localStorage` when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}

interface Ambient {
  key: string
  output: GainNode
  stop(): void
}

/** One sounding one-shot: its own gain into the fx bus, so it can be faded out alone. */
interface Voice {
  key: string
  output: GainNode
  source?: AudioBufferSourceNode
  timer: ReturnType<typeof setTimeout>
}

/** Fade applied by `stopOneShots`, seconds. */
const STOP_FADE_S = 0.06

function readVolume(storage: AudioEngineOptions['storage']): number {
  try {
    const v = storage?.getItem(VOLUME_KEY)
    if (v !== null && v !== undefined) {
      const n = Number(v)
      if (Number.isFinite(n)) return Math.min(1, Math.max(0, n))
    }
  } catch { /* private mode */ }
  return 0.8
}

export function createAudioEngine(opts: AudioEngineOptions): AudioEngine {
  const now = opts.now ?? (() => Date.now())
  const storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage
  const ctx = opts.createContext ? opts.createContext() : new AudioContext()

  const master = ctx.createGain()
  let volume = readVolume(storage)
  master.gain.value = volume
  master.connect(ctx.destination)
  const ambientBus = ctx.createGain()
  ambientBus.connect(master)
  const fxBus = ctx.createGain()
  fxBus.connect(master)

  let unlocked = ctx.state === 'running'
  const listeners = new Set<() => void>()
  const setUnlocked = (v: boolean) => {
    if (v === unlocked) return
    unlocked = v
    for (const l of listeners) l()
  }
  const onState = () => setUnlocked(ctx.state === 'running')
  ctx.addEventListener?.('statechange', onState)

  let current: Ambient | null = null
  let ambientSeq = 0
  const buffers = new Map<string, Promise<AudioBuffer>>()
  let disposed = false
  let lastImpact = -Infinity
  const voices = new Set<Voice>()
  const playingListeners = new Set<() => void>()
  const emitPlaying = () => { for (const l of playingListeners) l() }

  function endVoice(v: Voice) {
    if (!voices.delete(v)) return
    clearTimeout(v.timer)
    emitPlaying()
  }

  /** Tracks a one-shot until `durationS` has passed (plus a little release). */
  function startVoice(key: string, output: GainNode, durationS: number, source?: AudioBufferSourceNode) {
    const v: Voice = { key, output, source, timer: setTimeout(() => endVoice(v), Math.max(50, durationS * 1000 + 100)) }
    voices.add(v)
    if (source) source.onended = () => endVoice(v)
    emitPlaying()
  }

  function fadeOut(v: Voice) {
    const t = ctx.currentTime
    const g = v.output.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(0, t + STOP_FADE_S)
    setTimeout(() => {
      try { v.source?.stop() } catch { /* already stopped */ }
      v.output.disconnect()
    }, STOP_FADE_S * 1000 + 30)
    endVoice(v)
  }

  async function decode(ref: AssetRef): Promise<AudioBuffer> {
    let p = buffers.get(ref.sha256)
    if (!p) {
      p = (async () => {
        const url = await opts.resolve(ref)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`audio: fetch ${res.status} for ${ref.name ?? ref.sha256}`)
        return ctx.decodeAudioData(await res.arrayBuffer())
      })()
      buffers.set(ref.sha256, p)
      p.catch(() => buffers.delete(ref.sha256))
    }
    return p
  }

  /** Fade out whatever plays, fade in `next` (or nothing). */
  function crossfade(next: Ambient | null, volume: number, fadeMs: number) {
    const t = ctx.currentTime
    const fade = Math.max(0.01, fadeMs / 1000)
    const old = current
    if (old) {
      old.output.gain.cancelScheduledValues(t)
      old.output.gain.setValueAtTime(old.output.gain.value, t)
      old.output.gain.linearRampToValueAtTime(0, t + fade)
      setTimeout(() => old.stop(), fadeMs + 50)
    }
    if (next) {
      next.output.gain.setValueAtTime(0, t)
      next.output.gain.linearRampToValueAtTime(volume, t + fade)
      next.output.connect(ambientBus)
    }
    current = next
  }

  function ambienceFromPreset(key: string, preset: AmbientPreset): Ambient | null {
    const g: AmbienceGraph | null = buildAmbience(ctx, preset)
    return g ? { key, output: g.output, stop: () => g.stop() } : null
  }

  function ambienceFromBuffer(key: string, buffer: AudioBuffer): Ambient {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const output = ctx.createGain()
    src.connect(output)
    src.start()
    return { key, output, stop: () => { try { src.stop() } catch { /* already stopped */ } output.disconnect() } }
  }

  const engine: AudioEngine = {
    get unlocked() { return unlocked },

    async unlock() {
      if (disposed) return
      try {
        if (ctx.state !== 'running') await ctx.resume()
        // iOS: a context can report running yet stay muted until a buffer has actually played.
        const buf = ctx.createBuffer(1, 1, ctx.sampleRate)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(master)
        src.start()
      } catch (e) {
        console.warn('audio: unlock failed', e)
      }
      setUnlocked(ctx.state === 'running')
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    async setAmbient(asset, o) {
      if (disposed) return
      const seq = ++ambientSeq
      const fadeMs = o?.fadeMs ?? DEFAULT_FADE_MS
      const vol = o?.volume ?? 1
      if (!asset) {
        if (current) crossfade(null, vol, fadeMs)
        return
      }
      const builtin = asset.sources.find((s) => s.startsWith('builtin:'))
      const key = builtin ?? `asset:${asset.sha256}`
      if (current?.key === key) return
      if (builtin) {
        // `builtin:<preset>` as an ambient track means the procedural preset of that name.
        const preset = builtin.slice('builtin:'.length) as AmbientPreset
        crossfade(AMBIENT_PRESETS.includes(preset) ? ambienceFromPreset(key, preset) : null, vol, fadeMs)
        return
      }
      let buffer: AudioBuffer
      try {
        buffer = await decode(asset)
      } catch (e) {
        console.warn('audio: ambient failed', e)
        return
      }
      if (seq !== ambientSeq || disposed) return // superseded while decoding
      crossfade(ambienceFromBuffer(key, buffer), vol, fadeMs)
    },

    setAmbientPreset(name, o) {
      if (disposed) return
      ambientSeq++
      const preset: AmbientPreset = name ?? 'none'
      const key = `preset:${preset}`
      if (current?.key === key) return
      if (preset === 'none') {
        if (current) crossfade(null, 1, o?.fadeMs ?? DEFAULT_FADE_MS)
        return
      }
      crossfade(ambienceFromPreset(key, preset), o?.volume ?? 1, o?.fadeMs ?? DEFAULT_FADE_MS)
    },

    async playOneShot(asset, o) {
      if (disposed) return
      if (o?.at !== undefined && now() - o.at > STALE_ONE_SHOT_MS) return
      const vol = Math.min(2, Math.max(0, o?.volume ?? 1))
      const builtin = builtinName(asset)
      if (builtin) {
        const out = ctx.createGain()
        out.connect(fxBus)
        SYNTHS[builtin](ctx, out, ctx.currentTime, vol)
        startVoice(soundKey(asset), out, BUILTIN_DURATION_S[builtin])
        return
      }
      let buffer: AudioBuffer
      try {
        buffer = await decode(asset)
      } catch (e) {
        console.warn('audio: one-shot failed', e)
        return
      }
      if (disposed) return
      if (o?.at !== undefined && now() - o.at > STALE_ONE_SHOT_MS) return
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const g = ctx.createGain()
      g.gain.value = vol
      src.connect(g).connect(fxBus)
      src.start()
      startVoice(soundKey(asset), g, buffer.duration, src)
    },

    stopOneShots(key) {
      for (const v of [...voices]) if (key === undefined || v.key === key) fadeOut(v)
    },

    playing() {
      return new Set([...voices].map((v) => v.key))
    },

    onPlaying(listener) {
      playingListeners.add(listener)
      return () => { playingListeners.delete(listener) }
    },

    diceImpact(strength) {
      if (disposed) return
      const t = ctx.currentTime
      if (t - lastImpact < 0.012) return // many dice land at once; the ear hears one
      lastImpact = t
      synthDiceImpact(ctx, fxBus, t, strength)
    },

    turnChime() {
      if (disposed) return
      synthTurnChime(ctx, fxBus, ctx.currentTime)
    },

    setMasterVolume(v) {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02)
      try { storage?.setItem(VOLUME_KEY, String(volume)) } catch { /* quota / private mode */ }
    },

    getMasterVolume() { return volume },

    dispose() {
      if (disposed) return
      disposed = true
      ctx.removeEventListener?.('statechange', onState)
      current?.stop()
      current = null
      for (const v of [...voices]) fadeOut(v)
      listeners.clear()
      playingListeners.clear()
      void ctx.close?.().catch(() => {})
    },
  }
  return engine
}

let shared: AudioEngine | null = null
/**
 * One engine per page. The first caller's resolver wins; later callers get the same instance,
 * so the soundboard panel, the game hook and the dice tray share master volume and unlock state.
 */
export function sharedAudioEngine(opts: AudioEngineOptions): AudioEngine {
  shared ??= createAudioEngine(opts)
  return shared
}
