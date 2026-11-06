/**
 * Zustand store mirroring the Yjs document plus local UI state.
 * `bindDoc` subscribes to a Y.Doc and keeps the mirror in sync.
 */
import { create } from 'zustand'
import type * as Y from 'yjs'
import type { Character, ChatMessage, FogState, GameEvent, GameMeta, Note, Prop, Scene, Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { CharacterId, NoteId, PlayerPubkey, PropId, SceneId, SkillId, TokenId } from '@/core/ids'
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
  presence: Record<string, Presence>
  notices: LocalNotice[]
  pushNotice(text: string, at?: number): LocalNotice
  selectedToken: TokenId | null
  setSelectedToken(id: TokenId | null): void
  selection: Selection | null
  setSelection(sel: Selection | null): void
  setPresence(p: Presence): void
  _replaceFromDoc(partial: Partial<Pick<GameState, 'meta' | 'scenes' | 'tokens' | 'characters' | 'chat' | 'fog' | 'events' | 'props' | 'notes' | 'customSkills'>>): void
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
  presence: {},
  notices: [],
  pushNotice: (text, at = Date.now()) => {
    const notice: LocalNotice = { id: `notice-${++noticeSeq}`, at, text }
    set((s) => ({ notices: [...s.notices, notice].slice(-MAX_NOTICES) }))
    return notice
  },
  selectedToken: null,
  setSelectedToken: (id) => set({ selectedToken: id, selection: id ? { kind: 'token', id } : null }),
  selection: null,
  setSelection: (sel) => set({ selection: sel, selectedToken: sel?.kind === 'token' ? sel.id : null }),
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.pubkey]: p } })),
  // A scene switch drops the selection: the selected object belongs to the scene that was live.
  _replaceFromDoc: (partial) => set((s) => {
    const next = 'meta' in partial ? partial.meta?.activeScene ?? null : s.meta?.activeScene ?? null
    const prev = s.meta?.activeScene ?? null
    return next !== prev && s.selection ? { ...partial, selection: null, selectedToken: null } : partial
  }),
}))

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
    })
  }
  sync()
  doc.on('update', sync)
  return () => doc.off('update', sync)
}
