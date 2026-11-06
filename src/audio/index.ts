/**
 * Audio: ambient track per scene, GM soundboard (one-shot events), dice impact sounds.
 * Pure Web Audio; assets resolved through the asset resolver. Owned by the audio workstream.
 *
 * Built-in sounds are AssetRefs whose only source is `builtin:<name>` (see ./builtin); the engine
 * synthesizes them instead of resolving. Ambient presets are procedural graphs (see ./ambience).
 */
import type { AssetRef } from '@/core/assets'
import type { Scene } from '@/core/doc'

export type AmbientPreset = NonNullable<Scene['ambientPreset']>

export interface AudioEngine {
  /** Must be called from a user gesture on iOS/Safari before anything plays. */
  unlock(): Promise<void>
  readonly unlocked: boolean
  /** Fires when `unlocked` changes (also when the OS interrupts the context). Returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Crossfade to a new ambient loop (or silence when undefined). */
  setAmbient(asset: AssetRef | undefined, opts?: { volume?: number; fadeMs?: number }): Promise<void>
  /** Crossfade to a procedural ambience (or silence for 'none' / undefined). No assets involved. */
  setAmbientPreset(name: AmbientPreset | undefined, opts?: { volume?: number; fadeMs?: number }): void
  /** Play a one-shot. `at` is the shared timestamp from the GameEvent, used to skip stale events. */
  playOneShot(asset: AssetRef, opts?: { volume?: number; at?: number }): Promise<void>
  /** Synthesized dice click; strength 0..1. No asset needed. */
  diceImpact(strength: number): void
  setMasterVolume(v: number): void
  getMasterVolume(): number
  dispose(): void
}

export { createAudioEngine, sharedAudioEngine, STALE_ONE_SHOT_MS, type AudioEngineOptions } from './impl'
export { useGameAudio, useAudioUnlock, pickNewAudioEvents } from './useGameAudio'
export { BUILTIN_SOUNDS, builtinRef, builtinName, isBuiltin, type BuiltinSound } from './builtin'
export { AMBIENT_PRESETS } from './ambience'
