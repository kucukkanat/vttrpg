/**
 * Undo for destructive intents on the GM client. Nothing in the Yjs document is versioned, so the
 * controller captures the inverse of a destructive intent from the store *before* applying it and
 * keeps the last `MAX_UNDO` entries here. `undoLast()` dispatches the inverse through the same
 * controller, so players see the restore like any other change.
 *
 *   token.remove   -> token.add   (same token data)
 *   prop.remove    -> prop.add
 *   note.remove    -> note.upsert
 *   scene.remove   -> scene.add   (tokens, props and fog of the scene are never deleted, so they come back with it)
 *   fog.reset      -> fog.reveal  (the cells that were revealed), plus fog.revealAll if the map was fully revealed
 *   fog.revealAll  -> fog.reset   (then fog.reveal of what had been explored before)
 *   encounter.remove / creature.remove -> encounter.upsert / creature.upsert
 */
import { create } from 'zustand'
import type { Intent } from '@/core/intents'
import type { CreatureTemplate, Encounter, FogState, Note, Prop, Scene, Token } from '@/core/doc'
import type { NoteId, PropId, SceneId, TokenId } from '@/core/ids'

export const MAX_UNDO = 20

/** The parts of the store an inverse may need. A subset of `GameState`, so `useGame.getState()` fits. */
export interface UndoSnapshot {
  tokens: Record<TokenId, Token>
  props: Record<PropId, Prop>
  notes: Record<NoteId, Note>
  fog: Record<SceneId, FogState>
  scenes: Record<SceneId, Scene>
  /** Only `activeScene` is read: removing the live scene is refused, so there is nothing to undo. */
  meta?: { activeScene: SceneId | null } | null
  encounters?: Record<string, Encounter>
  creatures?: Record<string, CreatureTemplate>
}

export interface UndoEntry {
  /** What was done, for the toast: "Removed Rat Guard". */
  label: string
  /** What undoing brings back, for feedback: "Rat Guard". */
  subject: string
  /** Intents that revert the change, dispatched in order. */
  inverse: Intent[]
  at: number
}

/** Pure: the inverse of a destructive intent against the current state, or null if there is nothing to undo. */
export function captureUndo(intent: Intent, s: UndoSnapshot, now = Date.now()): UndoEntry | null {
  switch (intent.type) {
    case 'token.remove': {
      const token = s.tokens[intent.token]
      if (!token) return null
      return { label: `Removed ${token.name}`, subject: token.name, inverse: [{ type: 'token.add', token }], at: now }
    }
    case 'prop.remove': {
      const prop = s.props[intent.prop]
      if (!prop) return null
      return { label: `Removed ${prop.name}`, subject: prop.name, inverse: [{ type: 'prop.add', prop }], at: now }
    }
    case 'note.remove': {
      const note = s.notes[intent.note]
      if (!note) return null
      const title = note.title || 'note'
      return { label: `Deleted ${title}`, subject: title, inverse: [{ type: 'note.upsert', note }], at: now }
    }
    case 'encounter.remove': {
      const encounter = s.encounters?.[intent.encounter]
      if (!encounter) return null
      const name = encounter.name || 'encounter'
      return { label: `Deleted ${name}`, subject: name, inverse: [{ type: 'encounter.upsert', encounter }], at: now }
    }
    case 'creature.remove': {
      const creature = s.creatures?.[intent.creature]
      if (!creature) return null
      return { label: `Deleted ${creature.name}`, subject: creature.name, inverse: [{ type: 'creature.upsert', creature }], at: now }
    }
    case 'scene.remove': {
      const scene = s.scenes[intent.scene]
      if (!scene || s.meta?.activeScene === intent.scene) return null
      return { label: `Removed ${scene.name}`, subject: scene.name, inverse: [{ type: 'scene.add', scene }], at: now }
    }
    case 'fog.reset': {
      const fog = s.fog[intent.scene]
      if (!fog || (fog.revealed.length === 0 && !fog.revealAll)) return null
      const name = s.scenes[intent.scene]?.name ?? 'scene'
      const inverse: Intent[] = []
      if (fog.revealed.length) inverse.push({ type: 'fog.reveal', scene: intent.scene, cells: [...fog.revealed] })
      if (fog.revealAll) inverse.push({ type: 'fog.revealAll', scene: intent.scene })
      return { label: `Reset fog on ${name}`, subject: `fog on ${name}`, inverse, at: now }
    }
    case 'fog.revealAll': {
      const fog = s.fog[intent.scene]
      if (fog?.revealAll) return null
      const name = s.scenes[intent.scene]?.name ?? 'scene'
      const inverse: Intent[] = [{ type: 'fog.reset', scene: intent.scene }]
      if (fog && fog.revealed.length) inverse.push({ type: 'fog.reveal', scene: intent.scene, cells: [...fog.revealed] })
      return { label: `Revealed all of ${name}`, subject: `fog on ${name}`, inverse, at: now }
    }
    default:
      return null
  }
}

export type UndoDispatch = (intent: Intent) => Promise<void>

interface UndoState {
  stack: UndoEntry[]
  push(entry: UndoEntry): void
  pop(): UndoEntry | undefined
  clear(): void
}

export const useUndo = create<UndoState>((set, get) => ({
  stack: [],
  push: (entry) => set((s) => ({ stack: [...s.stack, entry].slice(-MAX_UNDO) })),
  pop: () => {
    const { stack } = get()
    if (stack.length === 0) return undefined
    set({ stack: stack.slice(0, -1) })
    return stack[stack.length - 1]
  },
  clear: () => set({ stack: [] }),
}))

let dispatcher: UndoDispatch | null = null

/**
 * The GM controller registers its dispatch here so `undoLast()` can be called from anywhere
 * (toast button, keyboard shortcut). A different dispatcher means a different game: the stack resets.
 */
export function bindUndoDispatcher(fn: UndoDispatch | null): void {
  if (fn === dispatcher) return
  dispatcher = fn
  useUndo.getState().clear()
}

/** Record the inverse of `intent` if it is destructive. Call before applying the intent. */
export function recordUndo(intent: Intent, s: UndoSnapshot): UndoEntry | null {
  const entry = captureUndo(intent, s)
  if (entry) useUndo.getState().push(entry)
  return entry
}

/** Revert the most recent destructive action. Resolves to the entry undone, or null when there was none. */
export async function undoLast(): Promise<UndoEntry | null> {
  const fn = dispatcher
  if (!fn) return null
  const entry = useUndo.getState().pop()
  if (!entry) return null
  for (const intent of entry.inverse) await fn(intent)
  return entry
}
