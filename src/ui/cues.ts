/**
 * Optional audio and speech cues, each with a visual twin: "your turn" when initiative reaches a
 * token you own, and "effect ended" when a condition comes off one of your tokens. Off by
 * default; the choice is per device (localStorage). Whenever a cue is on, its toast shows too, so
 * nothing is only audible. Detection is pure and tested; `useCues` wires it to the store.
 */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { InitiativeState, Token } from '@/core/doc'
import { builtinRef, sharedAudioEngine } from '@/audio'
import { useGame } from '@/state/store'
import type { GameController } from './controller'
import { pushToast } from './toasts'

export type CueId = 'turn' | 'expired'
export interface CueChannels { sound: boolean; speech: boolean }
export type CuePrefs = Record<CueId, CueChannels>

export const CUE_PREFS_KEY = 'vttrpg.cues'
export const CUE_PREFS_DEFAULT: CuePrefs = { turn: { sound: false, speech: false }, expired: { sound: false, speech: false } }
export const CUE_LABELS: Record<CueId, string> = { turn: 'Your turn', expired: 'Effect ended on your token' }

export function parseCuePrefs(raw: string | null): CuePrefs {
  const out: CuePrefs = { turn: { ...CUE_PREFS_DEFAULT.turn }, expired: { ...CUE_PREFS_DEFAULT.expired } }
  if (!raw) return out
  try {
    const v = JSON.parse(raw) as Record<string, Record<string, unknown> | undefined>
    for (const id of ['turn', 'expired'] as const) {
      out[id] = { sound: v?.[id]?.sound === true, speech: v?.[id]?.speech === true }
    }
  } catch { /* defaults */ }
  return out
}

const load = () => { try { return parseCuePrefs(localStorage.getItem(CUE_PREFS_KEY)) } catch { return parseCuePrefs(null) } }

export const useCuePrefs = create<{ prefs: CuePrefs; set(id: CueId, ch: Partial<CueChannels>): void }>((set) => ({
  prefs: load(),
  set: (id, ch) => set((s) => {
    const prefs = { ...s.prefs, [id]: { ...s.prefs[id], ...ch } }
    try { localStorage.setItem(CUE_PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
    return { prefs }
  }),
}))

export const cueOn = (c: CueChannels) => c.sound || c.speech

/** The token of yours that just came up, or null. Fires on a change of turn or round only. */
export function turnStarted(prev: InitiativeState | null, next: InitiativeState | null, tokens: Record<string, Token>, me: string): Token | null {
  if (!next?.active) return null
  const entry = next.order[next.turn]
  if (!entry) return null
  if (prev?.active && prev.turn === next.turn && prev.round === next.round && prev.order[prev.turn]?.token === entry.token) return null
  const t = tokens[entry.token]
  return t && t.owner === me ? t : null
}

/** Conditions that came off tokens you own between two snapshots of the token map. */
export function endedConditions(prev: Record<string, Token>, next: Record<string, Token>, me: string): { token: Token; condition: string }[] {
  const out: { token: Token; condition: string }[] = []
  for (const t of Object.values(next)) {
    if (t.owner !== me) continue
    const before = prev[t.id]
    if (!before) continue
    for (const c of before.conditions ?? []) if (!(t.conditions ?? []).includes(c)) out.push({ token: t, condition: c })
  }
  return out
}

function speak(text: string) {
  try {
    const synth = globalThis.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return
    synth.speak(new SpeechSynthesisUtterance(text))
  } catch { /* no speech here */ }
}

/** Runs the cues for the live game. Local only: nothing is written to the document. */
export function useCues(controller: GameController) {
  const prevInit = useRef(useGame.getState().initiative)
  const prevTokens = useRef(useGame.getState().tokens)
  useEffect(() => {
    const me = controller.pubkey
    const engine = () => sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) })
    const conditionName = (id: string) => controller.rules?.pack.conditions.find((c) => c.id === id)?.name ?? id
    const fire = (id: CueId, text: string, spoken: string, sound: Parameters<typeof builtinRef>[0]) => {
      const ch = useCuePrefs.getState().prefs[id]
      if (!cueOn(ch)) return
      pushToast({ key: `cue-${id}`, text, ttl: 4000 })
      if (ch.sound) void engine().playOneShot(builtinRef(sound), { volume: 0.7 })
      if (ch.speech) speak(spoken)
    }
    return useGame.subscribe((s) => {
      if (s.initiative !== prevInit.current) {
        const t = turnStarted(prevInit.current, s.initiative, s.tokens, me)
        prevInit.current = s.initiative
        if (t) fire('turn', `Your turn: ${t.name}`, `Your turn, ${t.name}`, 'coin')
      }
      if (s.tokens !== prevTokens.current) {
        const ended = endedConditions(prevTokens.current, s.tokens, me)
        prevTokens.current = s.tokens
        if (ended.length) {
          const text = ended.map((e) => `${conditionName(e.condition)} ended on ${e.token.name}`).join(' · ')
          fire('expired', text, text, 'drum')
        }
      }
    })
  }, [controller])
}

export function Cues({ controller }: { controller: GameController }) {
  useCues(controller)
  return null
}
