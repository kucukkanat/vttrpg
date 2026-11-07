/**
 * Zustand store mirroring the Yjs document plus local UI state.
 * `bindDoc` subscribes to a Y.Doc and keeps the mirror in sync.
 */
import { create } from 'zustand'
import type * as Y from 'yjs'
import type { Character, ChatMessage, FogState, GameEvent, GameMeta, InitiativeState, Note, PlacedLight, Prefab, Prop, Scene, Token, Wall } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { CharacterId, LightId, NoteId, PlayerPubkey, PrefabId, PropId, SceneId, SkillId, TokenId, WallId } from '@/core/ids'
import type { Presence } from '@/core/presence'

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
  /** Drawn walls and doors of every scene (filter by `scene`). */
  walls: Record<WallId, Wall>
  prefabs: Record<PrefabId, Prefab>
  lights: Record<LightId, PlacedLight>
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
  setPresence(p: Presence): void
  _replaceFromDoc(partial: Partial<Pick<GameState, 'meta' | 'scenes' | 'tokens' | 'characters' | 'chat' | 'fog' | 'events' | 'props' | 'notes' | 'customSkills' | 'initiative' | 'walls' | 'prefabs' | 'lights'>>): void
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
  walls: {} as Record<WallId, Wall>,
  prefabs: {} as Record<PrefabId, Prefab>,
  lights: {} as Record<LightId, PlacedLight>,
  presence: {},
  notices: [],
  pushNotice: (text, at = Date.now()) => {
    const notice: LocalNotice = { id: `notice-${++noticeSeq}`, at, text }
    set((s) => ({ notices: [...s.notices, notice].slice(-MAX_NOTICES) }))
    return notice
  },
  selectedToken: null,
  setSelectedToken: (id) => set(selectTokens(id ? [id] : [], id)),
  selectedTokens: [],
  toggleSelected: (id) => set((s) => {
    if (s.selectedTokens.includes(id)) {
      const rest = s.selectedTokens.filter((t) => t !== id)
      return selectTokens(rest, s.selectedToken === id ? rest[rest.length - 1] ?? null : s.selectedToken)
    }
    return selectTokens([...s.selectedTokens, id], s.selectedToken ?? id)
  }),
  selectMany: (ids, primary) => set((s) => {
    const unique = [...new Set(ids)]
    const keep = primary && unique.includes(primary) ? primary : s.selectedToken && unique.includes(s.selectedToken) ? s.selectedToken : unique[0] ?? null
    return selectTokens(unique, keep)
  }),
  clearSelection: () => set(selectTokens([], null)),
  selection: null,
  setSelection: (sel) => set({ selection: sel, selectedToken: sel?.kind === 'token' ? sel.id : null, selectedTokens: sel?.kind === 'token' ? [sel.id] : [] }),
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.pubkey]: p } })),
  // A scene switch drops the selection: the selected object belongs to the scene that was live.
  // Tokens that left the document (removed, or replaced on a resync) leave the selection too.
  _replaceFromDoc: (partial) => set((s) => {
    const next = 'meta' in partial ? partial.meta?.activeScene ?? null : s.meta?.activeScene ?? null
    const prev = s.meta?.activeScene ?? null
    if (next !== prev && s.selection) return { ...partial, selection: null, selectedToken: null, selectedTokens: [] }
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

/** Mirror a Y.Doc into the store. Returns an unsubscribe. */
export function bindDoc(doc: Y.Doc): () => void {
  const sync = () => {
    useGame.getState()._replaceFromDoc({
      meta: (doc.getMap('meta').toJSON() as GameMeta | Record<string, never>) as GameMeta,
      scenes: doc.getMap('scenes').toJSON() as Record<SceneId, Scene>,
      tokens: doc.getMap('tokens').toJSON() as Record<TokenId, Token>,
      characters: doc.getMap('characters').toJSON() as Record<CharacterId, Character>,
      chat: doc.getArray('chat').toJSON() as ChatMessage[],
      fog: doc.getMap('fog').toJSON() as Record<SceneId, FogState>,
      events: doc.getArray('events').toJSON() as GameEvent[],
      props: doc.getMap('props').toJSON() as Record<PropId, Prop>,
      notes: doc.getMap('notes').toJSON() as Record<NoteId, Note>,
      customSkills: doc.getMap('customSkills').toJSON() as Record<SkillId, SkillDef>,
      initiative: readInitiative(doc),
      walls: doc.getMap('walls').toJSON() as Record<WallId, Wall>,
      prefabs: doc.getMap('prefabs').toJSON() as Record<PrefabId, Prefab>,
      lights: doc.getMap('lights').toJSON() as Record<LightId, PlacedLight>,
    })
  }
  sync()
  doc.on('update', sync)
  return () => doc.off('update', sync)
}
