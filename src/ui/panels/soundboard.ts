/**
 * Soundboard state that is not the shared document: per-pad volumes the GM set on this device,
 * and a hook for which one-shots are sounding (the pads' "playing" ring). Pure parts are tested.
 */
import { useEffect, useState } from 'react'
import type { AudioEngine } from '@/audio'

export const PAD_VOLUME_KEY = 'vttrpg.soundboard.volumes'
/** Pads go up to 150 % (the engine clamps one-shots at 200 %). */
export const PAD_VOLUME_MAX = 1.5

export type PadVolumes = Record<string, number>

export const clampPadVolume = (v: number) => Math.min(PAD_VOLUME_MAX, Math.max(0, Number.isFinite(v) ? v : 1))

/** Reads the saved volumes, dropping anything that is not a finite number. */
export function parsePadVolumes(raw: string | null): PadVolumes {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: PadVolumes = {}
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = clampPadVolume(n)
    return out
  } catch {
    return {}
  }
}

export const padVolume = (volumes: PadVolumes, key: string) => volumes[key] ?? 1

export function loadPadVolumes(): PadVolumes {
  try { return parsePadVolumes(localStorage.getItem(PAD_VOLUME_KEY)) } catch { return {} }
}

export function savePadVolumes(v: PadVolumes) {
  try { localStorage.setItem(PAD_VOLUME_KEY, JSON.stringify(v)) } catch { /* private mode */ }
}

/** Keys of one-shots sounding right now on this device. */
export function usePlaying(engine: AudioEngine | null): ReadonlySet<string> {
  const [playing, setPlaying] = useState<ReadonlySet<string>>(() => engine?.playing() ?? new Set())
  useEffect(() => {
    if (!engine) return
    setPlaying(engine.playing())
    return engine.onPlaying(() => setPlaying(engine.playing()))
  }, [engine])
  return playing
}
