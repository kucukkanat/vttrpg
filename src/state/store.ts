/**
 * Zustand store mirroring the Yjs document plus local UI state.
 * `bindDoc` subscribes to a Y.Doc and keeps the mirror in sync.
 */
import { create } from 'zustand'
import type * as Y from 'yjs'
import type { Character, ChatMessage, CreatureTemplate, Encounter, FogState, GameEvent, GameMeta, InitiativeState, Note, PlacedLight, Prefab, Prop, Scene, Token, Wall } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { CatalogueEntry } from '@/core/catalogue'
import type { CharacterId, LightId, NoteId, PlayerPubkey, PrefabId, PropId, SceneId, SkillId, TokenId, WallId } from '@/core/ids'
import type { Presence } from '@/core/presence'
import type { SceneTiles } from '@/core/kits'
import { KITS_KEY, readChunk, readSceneTiles } from './tilesDoc'

/** What the local user has selected on the table. Tokens stay mirrored in `selectedToken`. */
export type Selection =
  | { kind: 'token'; id: TokenId }
  | { kind: 'prop'; id: PropId }
  /** A named node inside the active scene's GLB (edited via `scene.overrides`). */
  | { kind: 'node'; id: string }
  | { kind: 'scene'; id: SceneId }

/**
 * A local-only system line ("You are Pip", "GM is away"): shown in Chat interleaved by time,
 * never written to the shared document. See ui/notices.ts for who appends them.
 */
export interface LocalNotice {
  id: string
  at: number
  text: string
}

/** Oldest notices drop off past this many. */
export const MAX_NOTICES = 200

export interface GameState {
  meta: GameMeta | null
  scenes: Record<SceneId, Scene>
  tokens: Record<TokenId, Token>
  characters: Record<CharacterId, Character>
  chat: ChatMessage[]
  fog: Record<SceneId, FogState>
  events: GameEvent[]
  props: Record<PropId, Prop>
  notes: Record<NoteId, Note>
  customSkills: Record<SkillId, SkillDef>
  /** Turn order; null until the GM has started initiative once (then `active` says whether it is running). */
  initiative: InitiativeState | null
  /** Game creature templates (edited or homebrew stat blocks). */
  creatures: Record<string, CreatureTemplate>
  /** Prepared encounters. */
  encounters: Record<string, Encounter>
  /** Drawn walls and doors of every scene (filter by `scene`). */
  walls: Record<WallId, Wall>
  prefabs: Record<PrefabId, Prefab>
  lights: Record<LightId, PlacedLight>
  /**
   * Grid kit tiles by scene, mirrored chunk by chunk: an edit replaces only the chunk records it
   * touched (and the scene record holding them), so chunk renderers rebuild only what changed.
   */
  tiles: Record<SceneId, SceneTiles>
  /** The game's own models (imports and uploads), by catalogue id. */
  catalogue: Record<string, CatalogueEntry>
  presence: Record<string, Presence>
  notices: LocalNotice[]
  pushNotice(text: string, at?: number): LocalNotice
  selectedToken: TokenId | null
  setSelectedToken(id: TokenId | null): void
  /**
   * Every selected token (multi-select). `selectedToken` is the primary one and is always a member
   * when the set is non-empty; a plain select replaces the set with that one token.
   */
  selectedTokens: TokenId[]
  /** Add `id` to the set, or drop it when it is already selected (Shift/Cmd-click, Select mode). */
  toggleSelected(id: TokenId): void
  /** Replace the set; `primary` (default: the current primary if included, else the first id) becomes `selectedToken`. */
  selectMany(ids: readonly TokenId[], primary?: TokenId): void
  clearSelection(): void
  selection: Selection | null
  setSelection(sel: Selection | null): void
  /**
   * Every selected prop (multi-select, GM building). The primary item is the last one selected and
   * is mirrored as `selection` ({ kind: 'prop' }); a token, node or scene selection empties it.
   */
  propSelection: PropId[]
  /** Replace the prop selection; the last id becomes the primary `selection`. */
  setPropSelection(ids: readonly PropId[]): void
  /** Add `id`, or drop it when it is already selected (Shift-click). */
  togglePropSelected(id: PropId): void
  /** Add props to the selection (Shift-box); the last new one becomes the primary. */
  addPropsToSelection(ids: readonly PropId[]): void
  clearPropSelection(): void
  setPresence(p: Presence): void
  _replaceFromDoc(partial: Partial<Pick<GameState, 'meta' | 'scenes' | 'tokens' | 'characters' | 'chat' | 'fog' | 'events' | 'props' | 'notes' | 'customSkills' | 'initiative' | 'walls' | 'prefabs' | 'lights' | 'creatures' | 'encounters' | 'tiles' | 'catalogue'>>): void
}

let noticeSeq = 0

export const useGame = create<GameState>((set) => ({
  meta: null,
  scenes: {} as Record<SceneId, Scene>,
  tokens: {} as Record<TokenId, Token>,
  characters: {} as Record<CharacterId, Character>,
  chat: [],
  fog: {} as Record<SceneId, FogState>,
  events: [],
  props: {} as Record<PropId, Prop>,
  notes: {} as Record<NoteId, Note>,
  customSkills: {} as Record<SkillId, SkillDef>,
  initiative: null,
  creatures: {},
  encounters: {},
  walls: {} as Record<WallId, Wall>,
  prefabs: {} as Record<PrefabId, Prefab>,
  lights: {} as Record<LightId, PlacedLight>,
  tiles: {} as Record<SceneId, SceneTiles>,
  catalogue: {},
  presence: {},
  notices: [],
  pushNotice: (text, at = Date.now()) => {
    const notice: LocalNotice = { id: `notice-${++noticeSeq}`, at, text }
    set((s) => ({ notices: [...s.notices, notice].slice(-MAX_NOTICES) }))
    return notice
  },
  selectedToken: null,
  setSelectedToken: (id) => set({ ...selectTokens(id ? [id] : [], id), propSelection: [] }),
  selectedTokens: [],
  toggleSelected: (id) => set((s) => {
    if (s.selectedTokens.includes(id)) {
      const rest = s.selectedTokens.filter((t) => t !== id)
      return selectTokens(rest, s.selectedToken === id ? rest[rest.length - 1] ?? null : s.selectedToken)
    }
    return { ...selectTokens([...s.selectedTokens, id], s.selectedToken ?? id), propSelection: [] }
  }),
  selectMany: (ids, primary) => set((s) => {
    const unique = [...new Set(ids)]
    const keep = primary && unique.includes(primary) ? primary : s.selectedToken && unique.includes(s.selectedToken) ? s.selectedToken : unique[0] ?? null
    return { ...selectTokens(unique, keep), propSelection: [] }
  }),
  clearSelection: () => set({ ...selectTokens([], null), propSelection: [] }),
  selection: null,
  setSelection: (sel) => set({
    selection: sel, selectedToken: sel?.kind === 'token' ? sel.id : null, selectedTokens: sel?.kind === 'token' ? [sel.id] : [],
    propSelection: sel?.kind === 'prop' ? [sel.id] : [],
  }),
  propSelection: [],
  setPropSelection: (ids) => set(selectProps([...new Set(ids)])),
  togglePropSelected: (id) => set((s) => selectProps(s.propSelection.includes(id) ? s.propSelection.filter((p) => p !== id) : [...s.propSelection, id])),
  addPropsToSelection: (ids) => set((s) => {
    const fresh = ids.filter((id) => !s.propSelection.includes(id))
    return fresh.length ? selectProps([...s.propSelection, ...new Set(fresh)]) : s
  }),
  clearPropSelection: () => set((s) => (s.propSelection.length || s.selection?.kind === 'prop' ? selectProps([]) : s)),
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.pubkey]: p } })),
  // A scene switch drops the selection: the selected object belongs to the scene that was live.
  // Tokens that left the document (removed, or replaced on a resync) leave the selection too.
  _replaceFromDoc: (partial) => set((s) => {
    const next = 'meta' in partial ? partial.meta?.activeScene ?? null : s.meta?.activeScene ?? null
    const prev = s.meta?.activeScene ?? null
    if (next !== prev && (s.selection || s.propSelection.length)) return { ...partial, selection: null, selectedToken: null, selectedTokens: [], propSelection: [] }
    // Props that left the document (removed, undone) leave the selection.
    if (partial.props && s.propSelection.length) {
      const props = partial.props
      const kept = s.propSelection.filter((id) => id in props)
      if (kept.length !== s.propSelection.length) return { ...partial, ...selectProps(kept) }
    }
    if (partial.tokens && s.selectedTokens.length) {
      const tokens = partial.tokens
      const kept = s.selectedTokens.filter((id) => id in tokens)
      if (kept.length !== s.selectedTokens.length) {
        const primary = s.selectedToken && kept.includes(s.selectedToken) ? s.selectedToken : kept[kept.length - 1] ?? null
        return { ...partial, ...selectTokens(kept, primary) }
      }
    }
    return partial
  }),
}))

/** Store patch for a token selection: the set, its primary and the mirrored `selection`. */
function selectTokens(ids: TokenId[], primary: TokenId | null): Pick<GameState, 'selectedTokens' | 'selectedToken' | 'selection'> {
  const selectedToken = primary && ids.includes(primary) ? primary : ids[0] ?? null
  return { selectedTokens: ids, selectedToken, selection: selectedToken ? { kind: 'token', id: selectedToken } : null }
}

/** Store patch for a prop selection: the set, and its last member mirrored as the primary `selection`. */
export function selectProps(ids: PropId[]): Pick<GameState, 'propSelection' | 'selection' | 'selectedToken' | 'selectedTokens'> {
  const last = ids[ids.length - 1]
  return { propSelection: ids, selection: last ? { kind: 'prop', id: last } : null, selectedToken: null, selectedTokens: [] }
}

/**
 * The first token the user owns: visible tokens in the active scene first, then hidden ones there,
 * then tokens in other scenes. Undefined for the GM and for players who own nothing yet.
 */
export function firstOwnedToken(s: Pick<GameState, 'tokens' | 'meta'>, pubkey: PlayerPubkey | string | null | undefined): Token | undefined {
  if (!pubkey) return undefined
  const owned = Object.values(s.tokens).filter((t) => t.owner === pubkey)
  if (owned.length === 0) return undefined
  const active = s.meta?.activeScene
  const rank = (t: Token) => (t.scene === active ? (t.hidden ? 1 : 0) : 2)
  return owned.reduce((best, t) => (rank(t) < rank(best) ? t : best))
}

/**
 * The token a sheet-style panel should show: the selected one, else the first owned one so a
 * player's Character and Skills still show their own character when nothing is selected.
 */
export function effectiveToken(s: Pick<GameState, 'tokens' | 'meta' | 'selectedToken'>, pubkey: PlayerPubkey | string | null | undefined): Token | undefined {
  const selected = s.selectedToken ? s.tokens[s.selectedToken] : undefined
  return selected ?? firstOwnedToken(s, pubkey)
}

/** Reactive `effectiveToken` for panels. */
export function useEffectiveToken(pubkey: PlayerPubkey | string | null | undefined): Token | undefined {
  return useGame((s) => effectiveToken(s, pubkey))
}

/** The `initiative` map as state, or null while the GM has never started one (the map is empty). */
export function readInitiative(doc: Y.Doc): InitiativeState | null {
  const raw = doc.getMap('initiative').toJSON() as Partial<InitiativeState>
  if (!Array.isArray(raw.order)) return null
  const s: InitiativeState = { active: raw.active === true, round: raw.round ?? 0, turn: raw.turn ?? 0, order: raw.order }
  if (raw.declared) s.declared = raw.declared
  if (raw.log) s.log = raw.log
  return s
}

type DocPartial = Parameters<GameState['_replaceFromDoc']>[0]
type DocKey = keyof Required<DocPartial>

/** A Y.Map entry as plain JSON: the stored object itself, or a nested Yjs type (nothing writes those today) as JSON. */
function plain(v: unknown): unknown {
  return v && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function' ? (v as { toJSON(): unknown }).toJSON() : v
}

/**
 * Mirror a Y.Doc into the store. Returns an unsubscribe.
 *
 * Incremental: every top-level type is observed (deeply) and only the store keys whose type
 * changed in a transaction are re-read, so a chat line leaves `props`, `tokens` and the rest as
 * they were. Props are patched entry by entry: the `props` record is copied only when a prop
 * changed, and unchanged props keep their object identity, so memoised renderers skip them.
 */
export function bindDoc(doc: Y.Doc): () => void {
  const types: Record<DocKey, Y.Map<unknown> | Y.Array<unknown>> = {
    meta: doc.getMap('meta'), scenes: doc.getMap('scenes'), tokens: doc.getMap('tokens'), characters: doc.getMap('characters'),
    chat: doc.getArray('chat'), fog: doc.getMap('fog'), events: doc.getArray('events'), props: doc.getMap('props'),
    notes: doc.getMap('notes'), customSkills: doc.getMap('customSkills'), initiative: doc.getMap('initiative'),
    creatures: doc.getMap('creatures'), encounters: doc.getMap('encounters'), walls: doc.getMap('walls'),
    prefabs: doc.getMap('prefabs'), lights: doc.getMap('lights'), tiles: doc.getMap('tiles'), catalogue: doc.getMap('catalogue'),
  }
  const keys = Object.keys(types) as DocKey[]
  // An empty `meta` map mirrors as an empty object, as it always has.
  const read = (key: DocKey): unknown => (key === 'initiative' ? readInitiative(doc) : types[key].toJSON())

  const propsMap = types.props as Y.Map<unknown>
  let props = propsMap.toJSON() as Record<PropId, Prop>
  const dirty = new Set<DocKey>()

  const onProps = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    let next: Record<string, Prop> | null = null
    const put = (key: string) => {
      next ??= { ...props }
      const v = propsMap.get(key)
      if (v === undefined) delete next[key]
      else next[key] = plain(v) as Prop
    }
    for (const ev of events) {
      if (ev.target === propsMap) for (const key of ev.changes.keys.keys()) put(key)
      else if (typeof ev.path[0] === 'string') put(ev.path[0])
    }
    if (next) { props = next as Record<PropId, Prop>; dirty.add('props') }
  }
  propsMap.observeDeep(onProps)
  const tilesMap = types.tiles as Y.Map<unknown>
  let tiles = readTilesMirror(tilesMap)
  const onTiles = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const next = patchTiles(tiles, tilesMap, events)
    if (next !== tiles) { tiles = next; dirty.add('tiles') }
  }
  tilesMap.observeDeep(onTiles)
  const offOthers = keys.filter((k) => k !== 'props' && k !== 'tiles').map((key) => {
    const mark = () => { dirty.add(key) }
    types[key].observeDeep(mark)
    return () => types[key].unobserveDeep(mark)
  })

  const snapshot = (which: Iterable<DocKey>): DocPartial => {
    const out: Record<string, unknown> = {}
    for (const key of which) out[key] = key === 'props' ? props : key === 'tiles' ? tiles : read(key)
    return out as DocPartial
  }
  // Observers run in the transaction's cleanup, before the doc's 'update' event, so by then
  // `dirty` names every key the transaction touched.
  const sync = () => {
    if (!dirty.size) return
    const partial = snapshot(dirty)
    dirty.clear()
    useGame.getState()._replaceFromDoc(partial)
  }
  useGame.getState()._replaceFromDoc(snapshot(keys))
  doc.on('update', sync)
  return () => {
    doc.off('update', sync)
    propsMap.unobserveDeep(onProps)
    tilesMap.unobserveDeep(onTiles)
    for (const off of offOthers) off()
  }
}

function readTilesMirror(map: Y.Map<unknown>): Record<SceneId, SceneTiles> {
  const out: Record<string, SceneTiles> = {}
  for (const [id, scene] of map.entries()) out[id] = readSceneTiles(scene)
  return out as Record<SceneId, SceneTiles>
}

/**
 * The tiles mirror after a transaction's events: scenes, chunks and kit tables that changed are
 * re-read; every other scene and chunk record keeps its identity. Returns `prev` when nothing
 * changed.
 */
export function patchTiles(prev: Record<SceneId, SceneTiles>, map: Y.Map<unknown>, events: Y.YEvent<Y.AbstractType<unknown>>[]): Record<SceneId, SceneTiles> {
  let next: Record<string, SceneTiles> | null = null
  const scenes = (): Record<string, SceneTiles> => (next ??= { ...prev })
  // Scene records copied in this batch, and chunk records replaced in it (both safe to patch).
  const ownScenes = new Set<string>()
  const ownChunks = new Set<Record<string, string>>()
  const sceneCopy = (id: string): SceneTiles => {
    const all = scenes()
    if (!ownScenes.has(id)) {
      const old = all[id] ?? { kits: [], chunks: {} }
      all[id] = { kits: old.kits, chunks: { ...old.chunks } }
      ownScenes.add(id)
    }
    return all[id]!
  }
  for (const ev of events) {
    if (ev.target === map) {
      // Whole scenes added or removed.
      for (const id of ev.changes.keys.keys()) {
        const v = map.get(id)
        ownScenes.delete(id)
        if (v === undefined) delete scenes()[id]
        else scenes()[id] = readSceneTiles(v)
      }
      continue
    }
    const sceneId = ev.path[0]
    if (typeof sceneId !== 'string') continue
    const sm = map.get(sceneId) as Y.Map<unknown> | undefined
    if (!sm || typeof sm.get !== 'function') continue
    const t = sceneCopy(sceneId)
    if (ev.path.length === 1) {
      // Chunks added or removed, or the kit table changed.
      for (const key of ev.changes.keys.keys()) {
        if (key === KITS_KEY) { t.kits = readSceneTiles(sm).kits; continue }
        const c = sm.get(key)
        if (c === undefined) delete t.chunks[key]
        else { const rec = readChunk(c); ownChunks.add(rec); t.chunks[key] = rec }
      }
      continue
    }
    const chunkId = ev.path[1]
    if (typeof chunkId !== 'string') continue
    const chunk = sm.get(chunkId) as Y.Map<string> | undefined
    const cur = t.chunks[chunkId]
    let rec = cur
    if (!rec || !ownChunks.has(rec)) { rec = { ...(cur ?? {}) }; ownChunks.add(rec) }
    for (const key of ev.changes.keys.keys()) {
      const v = chunk?.get(key)
      if (typeof v === 'string') rec[key] = v
      else delete rec[key]
    }
    t.chunks[chunkId] = rec
  }
  return next ? (next as Record<SceneId, SceneTiles>) : prev
}
