/**
 * Zustand store mirroring the Yjs document plus local UI state.
 * `bindDoc` subscribes to a Y.Doc and keeps the mirror in sync.
 */
import { create } from 'zustand'
import type * as Y from 'yjs'
import type { Character, ChatMessage, FogState, GameEvent, GameMeta, Note, Prop, Scene, Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { CharacterId, NoteId, PropId, SceneId, SkillId, TokenId } from '@/core/ids'
import type { Presence } from '@/core/presence'

/** What the local user has selected on the table. Tokens stay mirrored in `selectedToken`. */
export type Selection =
  | { kind: 'token'; id: TokenId }
  | { kind: 'prop'; id: PropId }
  /** A named node inside the active scene's GLB (edited via `scene.overrides`). */
  | { kind: 'node'; id: string }
  | { kind: 'scene'; id: SceneId }

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
  selectedToken: TokenId | null
  setSelectedToken(id: TokenId | null): void
  selection: Selection | null
  setSelection(sel: Selection | null): void
  setPresence(p: Presence): void
  _replaceFromDoc(partial: Partial<Pick<GameState, 'meta' | 'scenes' | 'tokens' | 'characters' | 'chat' | 'fog' | 'events' | 'props' | 'notes' | 'customSkills'>>): void
}

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
  selectedToken: null,
  setSelectedToken: (id) => set({ selectedToken: id, selection: id ? { kind: 'token', id } : null }),
  selection: null,
  setSelection: (sel) => set({ selection: sel, selectedToken: sel?.kind === 'token' ? sel.id : null }),
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.pubkey]: p } })),
  _replaceFromDoc: (partial) => set(partial),
}))

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
