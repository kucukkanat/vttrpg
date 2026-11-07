/**
 * Turn-start cue for the player whose token is up: a short chime and a haptic, on top of the
 * "Your turn" toast and the camera nudge that `useTurnNotices` already gives. The ring flare on the
 * token is drawn by the table (`TurnRing`). Both follow the "Turn chime" preference; joining
 * mid-fight cues nothing (the first snapshot is a baseline). The GM gets no chime: NPC turns are
 * theirs to drive and would ring every few seconds.
 */
import { useEffect } from 'react'
import type { InitiativeState, Token } from '@/core/doc'
import { sharedAudioEngine } from '@/audio'
import { useGame } from '@/state/store'
import { useSession } from '../session'
import { haptic } from './haptics'
import { readPref } from './prefs'

/** Round and token of the current turn; null between encounters. */
export function turnKey(s: InitiativeState | null): string | null {
  if (!s || !s.active) return null
  const cur = s.order[s.turn]
  return cur ? `${s.round}:${cur.token}` : null
}

/** Whether moving from `prev` to the state's turn starts a turn the viewer should be cued for. */
export function cuesViewer(prev: string | null, s: InitiativeState | null, tokens: Readonly<Record<string, Token>>, me: string, isGm: boolean): boolean {
  const key = turnKey(s)
  if (!key || key === prev || isGm) return false
  const token = tokens[s!.order[s!.turn]!.token]
  return !!token && token.owner === me
}

export function TurnCue() {
  const { controller } = useSession()
  useEffect(() => {
    if (!controller) return
    const me = controller.pubkey
    const isGm = controller.connection.isGm
    let prev = turnKey(useGame.getState().initiative)
    return useGame.subscribe((s) => {
      const key = turnKey(s.initiative)
      if (key === prev) return
      const cue = cuesViewer(prev, s.initiative, s.tokens, me, isGm)
      prev = key
      if (!cue || !readPref('turnCue')) return
      haptic('turn')
      try { sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) }).turnChime() } catch { /* no audio context */ }
    })
  }, [controller])
  return null
}
