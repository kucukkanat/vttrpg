/**
 * Synthesized one-shots and the dice impact. Every function schedules nodes into `out` starting at
 * `when` (context time) and lets them garbage-collect after `stop`. Shared helpers are reused by
 * the ambiences.
 */
import type { BuiltinSound } from './builtin'

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/** One 2 s white-noise buffer per context, reused by every noise source. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx)
  if (!buf) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 2))
    buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, buf)
  }
  return buf
}

export function noiseSource(ctx: BaseAudioContext, loop = true): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.loop = loop
  if (loop) src.loopStart = 0
  return src
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = q
  return f
}

export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

/** Attack to `peak` then exponential-ish decay to silence; returns the end time. */
export function envelope(p: AudioParam, when: number, peak: number, attack: number, decay: number): number {
  p.cancelScheduledValues(when)
  p.setValueAtTime(0.0001, when)
  p.linearRampToValueAtTime(Math.max(peak, 0.0001), when + attack)
  p.exponentialRampToValueAtTime(0.0001, when + attack + decay)
  return when + attack + decay
}

/** Short filtered noise burst. */
export function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  o: { type?: BiquadFilterType; freq: number; q?: number; peak: number; attack?: number; decay: number; sweepTo?: number },
): void {
  const src = noiseSource(ctx, true)
  const f = filter(ctx, o.type ?? 'bandpass', o.freq, o.q ?? 1)
  if (o.sweepTo !== undefined) {
    f.frequency.setValueAtTime(o.freq, when)
    f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), when + (o.attack ?? 0.002) + o.decay)
  }
  const g = gain(ctx, 0)
  const end = envelope(g.gain, when, o.peak, o.attack ?? 0.002, o.decay)
  src.connect(f).connect(g).connect(out)
  src.start(when, Math.random() * 1.5)
  src.stop(end + 0.02)
}

/** Sine/other oscillator blip with optional pitch sweep. */
export function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  o: { type?: OscillatorType; freq: number; sweepTo?: number; peak: number; attack?: number; decay: number; detune?: number },
): OscillatorNode {
  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, when)
  if (o.detune) osc.detune.value = o.detune
  const g = gain(ctx, 0)
  const end = envelope(g.gain, when, o.peak, o.attack ?? 0.003, o.decay)
  if (o.sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), end)
  osc.connect(g).connect(out)
  osc.start(when)
  osc.stop(end + 0.02)
  return osc
}

/** "Your turn": two soft rising bell notes (a fifth apart), short enough not to talk over play. */
export function turnChime(ctx: BaseAudioContext, out: AudioNode, when: number, v = 1): void {
  const note = (t: number, freq: number, amp: number) => {
    tone(ctx, out, t, { freq, peak: 0.22 * amp * v, attack: 0.004, decay: 0.55 })
    tone(ctx, out, t, { freq: freq * 2.01, peak: 0.07 * amp * v, attack: 0.004, decay: 0.3 })
  }
  note(when, 659.25, 1)
  note(when + 0.13, 987.77, 0.85)
}

/** Dice hitting the tray: filtered noise tick + a short click, pitch randomized per impact. */
export function diceImpact(ctx: BaseAudioContext, out: AudioNode, when: number, strength: number): void {
  const s = Math.min(1, Math.max(0, strength))
  const amp = 0.15 + 0.55 * s
  noiseBurst(ctx, out, when, { freq: rand(1800, 4200), q: 1.2, peak: amp, attack: 0.001, decay: 0.03 + 0.05 * s })
  tone(ctx, out, when, { freq: rand(2200, 3600), sweepTo: rand(900, 1400), peak: amp * 0.5, attack: 0.001, decay: 0.02 + 0.03 * s })
  if (s > 0.6) noiseBurst(ctx, out, when + 0.004, { type: 'lowpass', freq: 500, peak: (s - 0.6) * 0.8, decay: 0.08 })
}

type Synth = (ctx: BaseAudioContext, out: AudioNode, when: number, volume: number) => void

const door: Synth = (ctx, out, when, v) => {
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(rand(70, 95), when)
  osc.frequency.linearRampToValueAtTime(rand(120, 160), when + 0.9)
  osc.frequency.linearRampToValueAtTime(rand(90, 110), when + 1.3)
  // wobble: the stick-slip of a hinge
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.setValueAtTime(9, when)
  lfo.frequency.linearRampToValueAtTime(18, when + 1.2)
  const depth = gain(ctx, 14)
  lfo.connect(depth).connect(osc.frequency)
  const bp = filter(ctx, 'bandpass', 700, 3.5)
  const g = gain(ctx, 0)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(0.7 * v, when + 0.15)
  g.gain.setValueAtTime(0.7 * v, when + 1.0)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4)
  osc.connect(bp).connect(g).connect(out)
  osc.start(when)
  lfo.start(when)
  osc.stop(when + 1.45)
  lfo.stop(when + 1.45)
  noiseBurst(ctx, out, when + 1.25, { type: 'lowpass', freq: 300, peak: 0.3 * v, decay: 0.15 })
}

const sword: Synth = (ctx, out, when, v) => {
  noiseBurst(ctx, out, when, { type: 'highpass', freq: 2500, peak: 0.6 * v, attack: 0.001, decay: 0.18 })
  const base = rand(2400, 3000)
  for (const [mult, decay] of [[1, 0.7], [1.5, 0.55], [2.23, 0.4], [3.1, 0.3]] as const) {
    tone(ctx, out, when, { freq: base * mult, peak: (0.22 / mult) * v, attack: 0.001, decay })
  }
  noiseBurst(ctx, out, when + 0.03, { freq: 5000, q: 2, peak: 0.25 * v, decay: 0.4 })
}

const thunder: Synth = (ctx, out, when, v) => {
  // leading crack, then a long rumble made of overlapping low bursts
  noiseBurst(ctx, out, when, { type: 'lowpass', freq: 1800, sweepTo: 200, peak: 0.7 * v, attack: 0.01, decay: 0.5 })
  let t = when + 0.15
  for (let i = 0; i < 7; i++) {
    noiseBurst(ctx, out, t, { type: 'lowpass', freq: rand(150, 320), sweepTo: 60, peak: (0.55 - i * 0.05) * v, attack: rand(0.05, 0.2), decay: rand(0.6, 1.4) })
    t += rand(0.15, 0.45)
  }
}

const coin: Synth = (ctx, out, when, v) => {
  const hit = (t: number, amp: number) => {
    const base = rand(4800, 5400)
    tone(ctx, out, t, { freq: base, peak: 0.25 * amp * v, attack: 0.001, decay: 0.35 })
    tone(ctx, out, t, { freq: base * 1.38, peak: 0.18 * amp * v, attack: 0.001, decay: 0.3, detune: 8 })
    tone(ctx, out, t, { freq: base * 1.71, peak: 0.12 * amp * v, attack: 0.001, decay: 0.22 })
    noiseBurst(ctx, out, t, { type: 'highpass', freq: 6000, peak: 0.15 * amp * v, attack: 0.001, decay: 0.03 })
  }
  hit(when, 1)
  hit(when + rand(0.08, 0.12), 0.7)
  hit(when + rand(0.2, 0.26), 0.4)
}

const scream: Synth = (ctx, out, when, v) => {
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  const f0 = rand(420, 520)
  osc.frequency.setValueAtTime(f0, when)
  osc.frequency.exponentialRampToValueAtTime(f0 * 1.9, when + 0.25)
  osc.frequency.setValueAtTime(f0 * 1.9, when + 0.6)
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.8, when + 1.1)
  const vib = ctx.createOscillator()
  vib.frequency.value = 6.5
  const vibDepth = gain(ctx, 25)
  vib.connect(vibDepth).connect(osc.frequency)
  const shaper = ctx.createWaveShaper()
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = (i / 127.5) - 1
    curve[i] = Math.tanh(x * 2.5)
  }
  shaper.curve = curve
  const formant = filter(ctx, 'bandpass', 1300, 2.5)
  formant.frequency.setValueAtTime(1000, when)
  formant.frequency.linearRampToValueAtTime(1800, when + 0.3)
  formant.frequency.linearRampToValueAtTime(900, when + 1.1)
  const g = gain(ctx, 0)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(0.4 * v, when + 0.08)
  g.gain.setValueAtTime(0.4 * v, when + 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 1.15)
  osc.connect(shaper).connect(formant).connect(g).connect(out)
  osc.start(when)
  vib.start(when)
  osc.stop(when + 1.2)
  vib.stop(when + 1.2)
  noiseBurst(ctx, out, when, { freq: 2500, q: 0.8, peak: 0.12 * v, attack: 0.05, decay: 0.9 })
}

const drum: Synth = (ctx, out, when, v) => {
  tone(ctx, out, when, { freq: 160, sweepTo: 45, peak: 0.9 * v, attack: 0.002, decay: 0.45 })
  noiseBurst(ctx, out, when, { type: 'lowpass', freq: 900, peak: 0.35 * v, attack: 0.001, decay: 0.05 })
  tone(ctx, out, when, { type: 'triangle', freq: 90, sweepTo: 40, peak: 0.4 * v, attack: 0.002, decay: 0.6 })
}

export const SYNTHS: Record<BuiltinSound, Synth> = { door, sword, thunder, coin, scream, drum }
