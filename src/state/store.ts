/**
 * Zustand store mirroring the Yjs document plus local UI state.
 * `bindDoc` subscribes to a Y.Doc and keeps the mirror in sync.
 */
import { create } from 'zustand'
import type * as Y from 'yjs'
import type { Character, ChatMessage, FogState, GameEvent, GameMeta, Scene, Token } from '@/core/doc'
import type { CharacterId, SceneId, TokenId } from '@/core/ids'
import type { Presence } from '@/core/presence'

export interface GameState {
  meta: GameMeta | null
  scenes: Record<SceneId, Scene>
  tokens: Record<TokenId, Token>
  characters: Record<CharacterId, Character>
  chat: ChatMessage[]
  fog: Record<SceneId, FogState>
  events: GameEvent[]
  presence: Record<string, Presence>
  selectedToken: TokenId | null
  setSelectedToken(id: TokenId | null): void
  setPresence(p: Presence): void
  _replaceFromDoc(partial: Partial<Pick<GameState, 'meta' | 'scenes' | 'tokens' | 'characters' | 'chat' | 'fog' | 'events'>>): void
}

export const useGame = create<GameState>((set) => ({
  meta: null,
  scenes: {} as Record<SceneId, Scene>,
  tokens: {} as Record<TokenId, Token>,
  characters: {} as Record<CharacterId, Character>,
  chat: [],
  fog: {} as Record<SceneId, FogState>,
  events: [],
  presence: {},
  selectedToken: null,
  setSelectedToken: (id) => set({ selectedToken: id }),
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
    })
  }
  sync()
  doc.on('update', sync)
  return () => doc.off('update', sync)
}
