/**
 * React glue: the active scene's ambience and new `audio` events drive the engine; a one-time
 * unlock button gets `useAudioUnlock`. The event selection is pure (`pickNewAudioEvents`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameEvent } from '@/core/doc'
import { useGame } from '@/state/store'
import type { AudioEngine } from './index'

export type AudioEvent = Extract<GameEvent, { kind: 'audio' }>

/**
 * Audio events not yet played and not older than `since` (ms epoch). Marks the ids it returns in
 * `played` and drops ids that left the event log so the set stays bounded.
 */
export function pickNewAudioEvents(events: GameEvent[], played: Set<string>, since: number): AudioEvent[] {
  const live = new Set<string>()
  const out: AudioEvent[] = []
  for (const e of events) {
    if (e.kind !== 'audio') continue
    live.add(e.id)
    if (played.has(e.id)) continue
    if (e.at < since) { played.add(e.id); continue }
    played.add(e.id)
    out.push(e)
  }
  for (const id of played) if (!live.has(id)) played.delete(id)
  return out
}

export function useGameAudio(engine: AudioEngine | null): void {
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const events = useGame((s) => s.events)
  const mountedAt = useRef<number>(Date.now())
  const played = useRef(new Set<string>())

  const ambientHash = scene?.ambientAudio?.sha256
  const preset = scene?.ambientPreset
  useEffect(() => {
    if (!engine) return
    if (scene?.ambientAudio) void engine.setAmbient(scene.ambientAudio)
    else engine.setAmbientPreset(preset ?? 'none')
    // Only the identity of the track or preset matters, not the rest of the scene object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, scene?.id, ambientHash, preset])

  useEffect(() => {
    if (!engine) return
    for (const e of pickNewAudioEvents(events, played.current, mountedAt.current)) {
      void engine.playOneShot(e.asset, { volume: e.volume, at: e.at })
    }
  }, [engine, events])
}

/** Unlock state plus a gesture handler for a one-time "Tap to enable sound" button. */
export function useAudioUnlock(engine: AudioEngine | null): { unlocked: boolean; unlock: () => Promise<void> } {
  const [unlocked, setUnlocked] = useState(engine?.unlocked ?? false)
  useEffect(() => {
    if (!engine) return
    setUnlocked(engine.unlocked)
    return engine.subscribe(() => setUnlocked(engine.unlocked))
  }, [engine])
  const unlock = useCallback(async () => {
    if (!engine) return
    await engine.unlock()
    setUnlocked(engine.unlocked)
  }, [engine])
  return { unlocked, unlock }
}
