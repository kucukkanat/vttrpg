/**
 * Audio: ambient track per scene, GM soundboard (one-shot events), dice impact sounds.
 * Pure Web Audio; assets resolved through the asset resolver. Owned by the audio workstream.
 */
import type { AssetRef } from '@/core/assets'

export interface AudioEngine {
  /** Must be called from a user gesture on iOS/Safari before anything plays. */
  unlock(): Promise<void>
  readonly unlocked: boolean
  /** Crossfade to a new ambient loop (or silence when undefined). */
  setAmbient(asset: AssetRef | undefined, opts?: { volume?: number; fadeMs?: number }): Promise<void>
  /** Play a one-shot. `at` is the shared timestamp from the GameEvent, used to skip stale events. */
  playOneShot(asset: AssetRef, opts?: { volume?: number; at?: number }): Promise<void>
  /** Synthesized dice click; strength 0..1. No asset needed. */
  diceImpact(strength: number): void
  setMasterVolume(v: number): void
  getMasterVolume(): number
  dispose(): void
}

export { createAudioEngine } from './impl'
export { useGameAudio } from './useGameAudio'
