/**
 * Undo and redo on the GM and co-GM clients, each with its own stacks (they live in this client's
 * memory, so every builder undoes only their own edits).
 *
 * The controller captures an entry from the store *before* applying an intent and settles it
 * against the store *after* (`captureUndo`, then `commitUndo`). `undoLast()` and `redoLast()`
 * dispatch through the same controller, so everyone sees the change like any other.
 *
 * Build edits on props keep each prop's full state before and after:
 *
 *   props.place  -> props.remove   (redo re-places the same props, same ids)
 *   props.update -> props.update   (the fields that differ, after -> before)
 *   props.remove -> props.place    (full snapshots)
 *   a stamp's walls ride along as wall.remove / wall.add
 *
 * Undo only touches props that are still exactly as this user left them (apply stamps `editedBy`
 * on every write, so someone else's edit never matches). A prop changed by someone else since is
 * skipped and the outcome carries a note; the rest of the step still applies.
 *
 * Other destructive intents keep their inverse (redo re-sends the original intent):
 *
 *   token.remove   -> token.add   (same token data)
 *   note.remove    -> note.upsert
 *   scene.remove   -> scene.add   (tokens, props and fog of the scene are never deleted, so they come back with it)
 *   fog.reset      -> fog.reveal  (the cells that were revealed), plus fog.revealAll if the map was fully revealed
 *   fog.revealAll  -> fog.reset   (then fog.reveal of what had been explored before)
 *   encounter.remove / creature.remove -> encounter.upsert / creature.upsert
 *   wall.remove    -> wall.add    (the removed walls and doors)
 *   light.remove   -> light.add
 *   prefab.remove  -> prefab.upsert
 */
import { create } from 'zustand'
import type { Intent, PropPatch } from '@/core/intents'
import type { CreatureTemplate, Encounter, FogState, Note, PlacedLight, Prefab, Prop, Scene, Token, Wall } from '@/core/doc'
import type { LightId, NoteId, PrefabId, PropId, SceneId, TokenId, WallId } from '@/core/ids'
import { patchToward, samePropState } from '@/core/props'
import { useGame } from './store'

export const MAX_UNDO = 100

/** The parts of the store an inverse may need. A subset of `GameState`, so `useGame.getState()` fits. */
export interface UndoSnapshot {
  tokens: Record<TokenId, Token>
  props: Record<PropId, Prop>
  notes: Record<NoteId, Note>
  fog: Record<SceneId, FogState>
  scenes: Record<SceneId, Scene>
  /** Optional so snapshots from before walls, lights and prefabs existed still fit. */
  walls?: Record<WallId, Wall>
  lights?: Record<LightId, PlacedLight>
  prefabs?: Record<PrefabId, Prefab>
  /** Only `activeScene` is read: removing the live scene is refused, so there is nothing to undo. */
  meta?: { activeScene: SceneId | null } | null
  encounters?: Record<string, Encounter>
  creatures?: Record<string, CreatureTemplate>
}

/** One prop in a build edit: null `before` = it was placed, null `after` = it was removed. */
export interface PropChange {
  id: PropId
  before: Prop | null
  after: Prop | null
}

export interface UndoEntry {
  /** What was done, for feedback: "Removed Rat Guard", "Moved 3 props". */
  label: string
  /** What undoing brings back: "Rat Guard". */
  subject: string
  /** Intents that revert the part of the change that is not props, dispatched in order. */
  inverse: Intent[]
  /** Intents that redo that part. */
  forward: Intent[]
  /** Build edits: every prop's state before and after, checked for conflicts on undo and redo. */
  props?: PropChange[]
  /** Something was destroyed: the controller offers an Undo toast. */
  destructive?: boolean
  at: number
}

/** What an undo or redo did: the entry as it now stands, plus the props it left alone. */
export type UndoOutcome = UndoEntry & {
  /** Props skipped because someone else changed them since. */
  skipped: PropId[]
  /** Set when something was skipped: why, in words. */
  note?: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function names(changes: PropChange[]): string {
  if (changes.length === 1) return (changes[0].before ?? changes[0].after)?.name || 'prop'
  return plural(changes.length, 'prop')
}

/** "Moved", "Turned", "Resized", "Renamed" or "Edited", from the fields the updates touch. */
function updateVerb(patches: PropPatch[]): string {
  const keys = new Set(patches.flatMap((p) => Object.keys(p)))
  if (keys.size === 1) {
    if (keys.has('position')) return 'Moved'
    if (keys.has('rotation')) return 'Turned'
    if (keys.has('scale')) return 'Resized'
    if (keys.has('name')) return 'Renamed'
  }
  if (keys.has('position') && !keys.has('name') && !keys.has('solid') && !keys.has('locked')) return 'Moved'
  return 'Edited'
}

/** A build-edit entry captured before apply (`after` is provisional until `commitUndo`). */
function propEntry(verb: string, changes: PropChange[], now: number, extra: Partial<Pick<UndoEntry, 'inverse' | 'forward' | 'destructive'>> = {}): UndoEntry | null {
  if (!changes.length) return null
  const subject = names(changes)
  return {
    label: `${verb} ${subject}`, subject, inverse: extra.inverse ?? [], forward: extra.forward ?? [], props: changes,
    ...(extra.destructive ? { destructive: true } : {}), at: now,
  }
}

/** Pure: the undo entry for `intent` against the state before it applies, or null if there is nothing to undo. */
export function captureUndo(intent: Intent, s: UndoSnapshot, now = Date.now()): UndoEntry | null {
  switch (intent.type) {
    case 'props.place':
    case 'prop.add': {
      const placed = intent.type === 'prop.add' ? [intent.prop] : intent.props
      const walls = intent.type === 'props.place' ? intent.walls ?? [] : []
      const changes = placed.filter((p) => !s.props[p.id]).map((p) => ({ id: p.id, before: null, after: { ...p } }))
      return propEntry('Placed', changes, now, walls.length
        ? { inverse: [{ type: 'wall.remove', walls: walls.map((w) => w.id) }], forward: [{ type: 'wall.add', walls }] }
        : {})
    }
    case 'props.update':
    case 'prop.update': {
      const updates = intent.type === 'prop.update' ? [{ id: intent.prop, patch: intent.patch as PropPatch }] : intent.updates
      const changes = updates.filter((u) => s.props[u.id]).map((u) => {
        const before = s.props[u.id]
        return { id: u.id, before, after: { ...before, ...u.patch, id: before.id } as Prop }
      })
      return propEntry(updateVerb(updates.map((u) => u.patch)), changes, now)
    }
    case 'props.remove':
    case 'prop.remove': {
      const ids = intent.type === 'prop.remove' ? [intent.prop] : intent.ids
      const changes = ids.filter((id) => s.props[id]).map((id) => ({ id, before: s.props[id], after: null }))
      return propEntry('Removed', changes, now, { destructive: true })
    }
    case 'token.remove': {
      const token = s.tokens[intent.token]
      if (!token) return null
      return { label: `Removed ${token.name}`, subject: token.name, inverse: [{ type: 'token.add', token }], forward: [intent], destructive: true, at: now }
    }
    case 'note.remove': {
      const note = s.notes[intent.note]
      if (!note) return null
      const title = note.title || 'note'
      return { label: `Deleted ${title}`, subject: title, inverse: [{ type: 'note.upsert', note }], forward: [intent], destructive: true, at: now }
    }
    case 'encounter.remove': {
      const encounter = s.encounters?.[intent.encounter]
      if (!encounter) return null
      const name = encounter.name || 'encounter'
      return { label: `Deleted ${name}`, subject: name, inverse: [{ type: 'encounter.upsert', encounter }], forward: [intent], destructive: true, at: now }
    }
    case 'creature.remove': {
      const creature = s.creatures?.[intent.creature]
      if (!creature) return null
      return { label: `Deleted ${creature.name}`, subject: creature.name, inverse: [{ type: 'creature.upsert', creature }], forward: [intent], destructive: true, at: now }
    }
    case 'scene.remove': {
      const scene = s.scenes[intent.scene]
      if (!scene || s.meta?.activeScene === intent.scene) return null
      return { label: `Removed ${scene.name}`, subject: scene.name, inverse: [{ type: 'scene.add', scene }], forward: [intent], destructive: true, at: now }
    }
    case 'fog.reset': {
      const fog = s.fog[intent.scene]
      if (!fog || (fog.revealed.length === 0 && !fog.revealAll)) return null
      const name = s.scenes[intent.scene]?.name ?? 'scene'
      const inverse: Intent[] = []
      if (fog.revealed.length) inverse.push({ type: 'fog.reveal', scene: intent.scene, cells: [...fog.revealed] })
      if (fog.revealAll) inverse.push({ type: 'fog.revealAll', scene: intent.scene })
      return { label: `Reset fog on ${name}`, subject: `fog on ${name}`, inverse, forward: [intent], destructive: true, at: now }
    }
    case 'fog.revealAll': {
      const fog = s.fog[intent.scene]
      if (fog?.revealAll) return null
      const name = s.scenes[intent.scene]?.name ?? 'scene'
      const inverse: Intent[] = [{ type: 'fog.reset', scene: intent.scene }]
      if (fog && fog.revealed.length) inverse.push({ type: 'fog.reveal', scene: intent.scene, cells: [...fog.revealed] })
      return { label: `Revealed all of ${name}`, subject: `fog on ${name}`, inverse, forward: [intent], destructive: true, at: now }
    }
    case 'wall.remove': {
      const gone = intent.walls.map((id) => s.walls?.[id]).filter((w): w is Wall => !!w)
      if (!gone.length) return null
      const doors = gone.filter((w) => w.door).length
      const what = doors === gone.length ? plural(doors, 'door') : doors ? `${plural(gone.length, 'wall')} and doors` : plural(gone.length, 'wall')
      return { label: `Removed ${what}`, subject: what, inverse: [{ type: 'wall.add', walls: gone }], forward: [intent], destructive: true, at: now }
    }
    case 'light.remove': {
      const light = s.lights?.[intent.light]
      if (!light) return null
      return { label: 'Removed a light', subject: 'the light', inverse: [{ type: 'light.add', light }], forward: [intent], destructive: true, at: now }
    }
    case 'prefab.remove': {
      const prefab = s.prefabs?.[intent.prefab]
      if (!prefab) return null
      return { label: `Deleted ${prefab.name}`, subject: prefab.name, inverse: [{ type: 'prefab.upsert', prefab }], forward: [intent], destructive: true, at: now }
    }
    default:
      return null
  }
}

export type UndoDispatch = (intent: Intent) => Promise<void>

interface UndoState {
  /** Undo entries, most recent last. */
  stack: UndoEntry[]
  /** Redo entries, most recent last. */
  redo: UndoEntry[]
  /** A new edit: onto the undo stack (MAX_UNDO deep), and the redo stack is cleared. */
  push(entry: UndoEntry): void
  pop(): UndoEntry | undefined
  popRedo(): UndoEntry | undefined
  /** Put an entry on one stack without touching the other (after an undo or a redo). */
  pushUndo(entry: UndoEntry): void
  pushRedo(entry: UndoEntry): void
  clear(): void
}

export const useUndo = create<UndoState>((set, get) => ({
  stack: [],
  redo: [],
  push: (entry) => set((s) => ({ stack: [...s.stack, entry].slice(-MAX_UNDO), redo: [] })),
  pop: () => {
    const { stack } = get()
    if (stack.length === 0) return undefined
    set({ stack: stack.slice(0, -1) })
    return stack[stack.length - 1]
  },
  popRedo: () => {
    const { redo } = get()
    if (redo.length === 0) return undefined
    set({ redo: redo.slice(0, -1) })
    return redo[redo.length - 1]
  },
  pushUndo: (entry) => set((s) => ({ stack: [...s.stack, entry].slice(-MAX_UNDO) })),
  pushRedo: (entry) => set((s) => ({ redo: [...s.redo, entry].slice(-MAX_UNDO) })),
  clear: () => set({ stack: [], redo: [] }),
}))

type ReadProps = () => Pick<UndoSnapshot, 'props'>

let dispatcher: UndoDispatch | null = null
let readState: ReadProps = () => useGame.getState()
/** True while an undo or redo is dispatching: those intents are not recorded as new edits. */
let replaying = false

/**
 * The controller registers its dispatch here so `undoLast()` and `redoLast()` can be called from
 * anywhere (toast button, keyboard shortcut). A different dispatcher means a different game: the
 * stacks reset. `read` gives the current document state (the store by default).
 */
export function bindUndoDispatcher(fn: UndoDispatch | null, read?: ReadProps): void {
  readState = read ?? (() => useGame.getState())
  if (fn === dispatcher) return
  dispatcher = fn
  useUndo.getState().clear()
}

/** True while `undoLast` or `redoLast` is dispatching. */
export function isReplaying(): boolean {
  return replaying
}

/**
 * Settle a captured entry against the state *after* its intent applied: each prop's `after`
 * becomes what the document now holds (with the `editedBy` apply stamped). Props the intent did
 * not change (a refused intent, a no-op patch) drop out; null when nothing is left to undo.
 */
export function settleUndo(entry: UndoEntry, s: Pick<UndoSnapshot, 'props'>): UndoEntry | null {
  if (!entry.props) return entry
  const props = entry.props
    .map((c) => ({ id: c.id, before: c.before, after: s.props[c.id] ?? null }))
    .filter((c) => !samePropState(c.after, c.before))
  if (!props.length) return null
  return { ...entry, props }
}

/** Settle `entry` (see `settleUndo`) and push it as a new edit, unless an undo or redo is running. */
export function commitUndo(entry: UndoEntry | null, s: Pick<UndoSnapshot, 'props'>): UndoEntry | null {
  if (!entry || replaying) return null
  const settled = settleUndo(entry, s)
  if (settled) useUndo.getState().push(settled)
  return settled
}

/** Capture and push in one step, without settling (the entry keeps its provisional `after`). */
export function recordUndo(intent: Intent, s: UndoSnapshot): UndoEntry | null {
  if (replaying) return null
  const entry = captureUndo(intent, s)
  if (entry) useUndo.getState().push(entry)
  return entry
}

/** The batch intents that move each prop of `changes` from its current state to the change's `target` side. */
function propIntents(changes: PropChange[], current: Record<PropId, Prop>, target: 'before' | 'after'): Intent[] {
  const place: Prop[] = []
  const remove: PropId[] = []
  const updates: { id: PropId; patch: PropPatch }[] = []
  for (const c of changes) {
    const want = c[target]
    const have = current[c.id]
    if (want && !have) place.push(want)
    else if (!want && have) remove.push(c.id)
    else if (want && have) {
      const patch = patchToward(have, want)
      if (patch) updates.push({ id: c.id, patch })
    }
  }
  const out: Intent[] = []
  if (place.length) out.push({ type: 'props.place', props: place })
  if (updates.length) out.push({ type: 'props.update', updates })
  if (remove.length) out.push({ type: 'props.remove', ids: remove })
  return out
}

/**
 * Undo or redo `entry`: props still in the state the step expects move to its other side; props
 * someone else changed are skipped. The step, reduced to what it did and refreshed with the
 * states the document now holds, goes onto the other stack.
 */
async function replay(entry: UndoEntry, dir: 'undo' | 'redo', fn: UndoDispatch): Promise<UndoOutcome> {
  const expected = dir === 'undo' ? 'after' : 'before'
  const target = dir === 'undo' ? 'before' : 'after'
  const s = readState()
  const ok: PropChange[] = []
  const skipped: PropChange[] = []
  for (const c of entry.props ?? []) (samePropState(s.props[c.id], c[expected]) ? ok : skipped).push(c)
  const intents = [...propIntents(ok, s.props, target), ...(dir === 'undo' ? entry.inverse : entry.forward)]
  replaying = true
  try {
    for (const intent of intents) await fn(intent)
  } finally {
    replaying = false
  }
  const now = readState()
  const props = ok.map((c) => ({ ...c, [target]: now.props[c.id] ?? null }))
  const reduced: UndoEntry = entry.props ? { ...entry, props } : entry
  if (intents.length && (!entry.props || props.length)) {
    if (dir === 'undo') useUndo.getState().pushRedo(reduced)
    else useUndo.getState().pushUndo(reduced)
  }
  const outcome: UndoOutcome = { ...reduced, skipped: skipped.map((c) => c.id) }
  if (skipped.length) {
    const one = skipped.length === 1
    outcome.note = `${names(skipped)} ${one ? 'was' : 'were'} changed by someone else since; left as ${one ? 'it is' : 'they are'}`
  }
  return outcome
}

/** Revert this user's most recent edit. Resolves to the outcome, or null when there was nothing to undo. */
export async function undoLast(): Promise<UndoOutcome | null> {
  const fn = dispatcher
  if (!fn || replaying) return null
  const entry = useUndo.getState().pop()
  if (!entry) return null
  return replay(entry, 'undo', fn)
}

/** Re-apply the most recently undone edit. Resolves to the outcome, or null when there was nothing to redo. */
export async function redoLast(): Promise<UndoOutcome | null> {
  const fn = dispatcher
  if (!fn || replaying) return null
  const entry = useUndo.getState().popRedo()
  if (!entry) return null
  return replay(entry, 'redo', fn)
}

/** Feedback line for an undo or redo: "Restored Crate", "Undid: Moved 3 props", plus any skip note. */
export function describeOutcome(o: UndoOutcome, dir: 'undo' | 'redo'): string {
  const did = !o.props || o.props.length > 0
  if (!did) return o.note ? `Nothing to ${dir}: ${o.note}` : `Nothing to ${dir}`
  const head = dir === 'undo' ? (o.destructive ? `Restored ${o.subject}` : `Undid: ${o.label}`) : `Redid: ${o.label}`
  return o.note ? `${head}. ${o.note}` : head
}
