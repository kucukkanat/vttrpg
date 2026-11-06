/**
 * Procedural ambiences. Each builds a graph that plays forever into its `output` gain (unity, the
 * engine fades it), costs a handful of nodes, and tears everything down on `stop()`. Sparse
 * details (drips, crackles, chirps, clinks) are scheduled by a timer that looks ahead so they stay
 * on the audio clock even when the tab is throttled.
 */
import type { AmbientPreset } from './index'
import { filter, gain, noiseBurst, noiseSource, rand, tone } from './synth'

export const AMBIENT_PRESETS: AmbientPreset[] = ['none', 'wind', 'fire', 'rain', 'cave', 'tavern', 'forest']

export interface AmbienceGraph {
  output: GainNode
  stop(): void
}

/** Fires `fn(whenInContextTime)` at random intervals in [minMs, maxMs]; scheduled ~100 ms ahead. */
class Scheduler {
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private stopped = false
  constructor(private ctx: BaseAudioContext) {}
  every(minMs: number, maxMs: number, fn: (when: number) => void): void {
    const tick = () => {
      if (this.stopped) return
      fn(this.ctx.currentTime + 0.1)
      const t = setTimeout(() => { this.timers.delete(t); tick() }, rand(minMs, maxMs))
      this.timers.add(t)
    }
    const first = setTimeout(() => { this.timers.delete(first); tick() }, rand(minMs * 0.3, maxMs * 0.6))
    this.timers.add(first)
  }
  stop(): void {
    this.stopped = true
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }
}

function lfo(ctx: BaseAudioContext, hz: number, depth: number, target: AudioParam): OscillatorNode {
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.value = hz
  const g = gain(ctx, depth)
  o.connect(g).connect(target)
  o.start()
  return o
}

type Builder = (ctx: BaseAudioContext) => AmbienceGraph

function graph(ctx: BaseAudioContext, setup: (out: GainNode, sched: Scheduler, started: AudioScheduledSourceNode[]) => void): AmbienceGraph {
  const output = gain(ctx, 1)
  const sched = new Scheduler(ctx)
  const started: AudioScheduledSourceNode[] = []
  setup(output, sched, started)
  return {
    output,
    stop() {
      sched.stop()
      for (const n of started) { try { n.stop() } catch { /* already stopped */ } }
      output.disconnect()
    },
  }
}

/** Filtered noise with slow frequency and amplitude LFOs. Shared by wind and forest. */
function windLayer(ctx: BaseAudioContext, out: AudioNode, started: AudioScheduledSourceNode[], o: { cutoff: number; level: number }): void {
  const src = noiseSource(ctx)
  const bp = filter(ctx, 'bandpass', o.cutoff, 0.6)
  const g = gain(ctx, o.level)
  src.connect(bp).connect(g).connect(out)
  src.start()
  started.push(src, lfo(ctx, 0.11, o.cutoff * 0.5, bp.frequency), lfo(ctx, 0.07, o.level * 0.5, g.gain), lfo(ctx, 0.23, o.level * 0.15, g.gain))
}

const wind: Builder = (ctx) => graph(ctx, (out, _s, started) => {
  windLayer(ctx, out, started, { cutoff: 420, level: 0.5 })
  // thin whistle on top
  const src = noiseSource(ctx)
  const bp = filter(ctx, 'bandpass', 1400, 4)
  const g = gain(ctx, 0.05)
  src.connect(bp).connect(g).connect(out)
  src.start()
  started.push(src, lfo(ctx, 0.05, 500, bp.frequency), lfo(ctx, 0.13, 0.04, g.gain))
})

const fire: Builder = (ctx) => graph(ctx, (out, sched, started) => {
  const rumble = noiseSource(ctx)
  const lp = filter(ctx, 'lowpass', 160, 0.9)
  const g = gain(ctx, 1.4)
  rumble.connect(lp).connect(g).connect(out)
  rumble.start()
  started.push(rumble, lfo(ctx, 0.3, 0.4, g.gain), lfo(ctx, 1.7, 0.2, g.gain))
  const hiss = noiseSource(ctx)
  const hp = filter(ctx, 'bandpass', 3500, 1.5)
  const hg = gain(ctx, 0.05)
  hiss.connect(hp).connect(hg).connect(out)
  hiss.start()
  started.push(hiss, lfo(ctx, 0.9, 0.02, hg.gain))
  sched.every(40, 260, (when) => {
    noiseBurst(ctx, out, when, { freq: rand(1800, 6000), q: rand(1.5, 4), peak: rand(0.15, 0.5), attack: 0.001, decay: rand(0.008, 0.03) })
    if (Math.random() < 0.15) noiseBurst(ctx, out, when + 0.01, { type: 'lowpass', freq: 400, peak: 0.25, decay: 0.08 })
  })
})

const rain: Builder = (ctx) => graph(ctx, (out, sched, started) => {
  const src = noiseSource(ctx)
  const hp = filter(ctx, 'highpass', 900, 0.7)
  const lp = filter(ctx, 'lowpass', 7000, 0.7)
  const g = gain(ctx, 0.3)
  src.connect(hp).connect(lp).connect(g).connect(out)
  src.start()
  started.push(src, lfo(ctx, 0.09, 0.06, g.gain), lfo(ctx, 0.17, 1500, lp.frequency))
  // distant body
  const body = noiseSource(ctx)
  const bp = filter(ctx, 'bandpass', 300, 0.8)
  const bg = gain(ctx, 0.12)
  body.connect(bp).connect(bg).connect(out)
  body.start()
  started.push(body)
  sched.every(250, 1400, (when) => {
    tone(ctx, out, when, { freq: rand(1400, 3200), sweepTo: rand(600, 1000), peak: rand(0.04, 0.12), attack: 0.002, decay: rand(0.05, 0.12) })
  })
})

const cave: Builder = (ctx) => graph(ctx, (out, sched, started) => {
  const drone = gain(ctx, 0.1)
  for (const [f, d] of [[42, 0], [63, -7], [84, 5]] as const) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    o.detune.value = d
    const og = gain(ctx, f === 42 ? 1 : 0.35)
    o.connect(og).connect(drone)
    o.start()
    started.push(o)
  }
  const lp = filter(ctx, 'lowpass', 220, 0.5)
  drone.connect(lp).connect(out)
  started.push(lfo(ctx, 0.05, 0.04, drone.gain), lfo(ctx, 0.021, 60, lp.frequency))
  const air = noiseSource(ctx)
  const abp = filter(ctx, 'bandpass', 180, 1)
  const ag = gain(ctx, 0.08)
  air.connect(abp).connect(ag).connect(out)
  air.start()
  started.push(air)
  // echoing drips: feedback delay
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.37
  const fb = gain(ctx, 0.45)
  const wet = gain(ctx, 0.6)
  const dripBus = gain(ctx, 1)
  dripBus.connect(out)
  dripBus.connect(delay)
  delay.connect(fb).connect(delay)
  delay.connect(wet).connect(out)
  sched.every(1800, 6000, (when) => {
    tone(ctx, dripBus, when, { freq: rand(1800, 3600), sweepTo: rand(700, 1200), peak: rand(0.08, 0.2), attack: 0.002, decay: rand(0.06, 0.14) })
  })
})

const tavern: Builder = (ctx) => graph(ctx, (out, sched, started) => {
  // murmur: two voice-band noise layers with independent random amplitude walks
  const voices: GainNode[] = []
  for (const [f, q, lvl] of [[420, 1.2, 0.7], [900, 1.5, 0.4], [1700, 2, 0.18]] as const) {
    const src = noiseSource(ctx)
    const bp = filter(ctx, 'bandpass', f, q)
    const g = gain(ctx, lvl)
    src.connect(bp).connect(g).connect(out)
    src.start()
    started.push(src)
    voices.push(g)
  }
  sched.every(90, 220, (when) => {
    for (const g of voices) g.gain.setTargetAtTime(g.gain.value * rand(0.55, 1.45) * 0.3 + g.gain.value * 0.7, when, 0.08)
  })
  // keep the walk bounded
  sched.every(1500, 2500, (when) => {
    const levels = [0.7, 0.4, 0.18]
    voices.forEach((g, i) => g.gain.setTargetAtTime(levels[i] * rand(0.7, 1.3), when, 0.6))
  })
  const room = noiseSource(ctx)
  const lp = filter(ctx, 'lowpass', 250, 0.7)
  const rg = gain(ctx, 0.35)
  room.connect(lp).connect(rg).connect(out)
  room.start()
  started.push(room, lfo(ctx, 0.2, 0.04, rg.gain))
  sched.every(1800, 5500, (when) => {
    const f = rand(2600, 4800)
    tone(ctx, out, when, { freq: f, peak: rand(0.05, 0.12), attack: 0.001, decay: rand(0.2, 0.4) })
    tone(ctx, out, when, { freq: f * 1.42, peak: rand(0.03, 0.07), attack: 0.001, decay: 0.25 })
    if (Math.random() < 0.3) noiseBurst(ctx, out, when + rand(0.2, 0.5), { type: 'lowpass', freq: 500, peak: 0.15, decay: 0.07 })
  })
})

const forest: Builder = (ctx) => graph(ctx, (out, sched, started) => {
  windLayer(ctx, out, started, { cutoff: 700, level: 0.28 })
  // leaves
  const src = noiseSource(ctx)
  const bp = filter(ctx, 'bandpass', 3000, 1)
  const g = gain(ctx, 0.04)
  src.connect(bp).connect(g).connect(out)
  src.start()
  started.push(src, lfo(ctx, 0.15, 0.03, g.gain))
  sched.every(700, 3200, (when) => {
    const n = 2 + Math.floor(Math.random() * 3)
    const base = rand(2400, 4800)
    let t = when
    for (let i = 0; i < n; i++) {
      tone(ctx, out, t, { freq: base * rand(0.9, 1.1), sweepTo: base * rand(1.1, 1.5), peak: rand(0.03, 0.08), attack: 0.005, decay: rand(0.04, 0.09) })
      t += rand(0.06, 0.14)
    }
  })
})

const BUILDERS: Record<Exclude<AmbientPreset, 'none'>, Builder> = { wind, fire, rain, cave, tavern, forest }

/** Build the graph for a preset; `null` for 'none'. */
export function buildAmbience(ctx: BaseAudioContext, preset: AmbientPreset): AmbienceGraph | null {
  if (preset === 'none') return null
  return BUILDERS[preset](ctx)
}
