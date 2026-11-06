/**
 * Sync layer: Nostr identity, game rooms, NIP-44 encryption, Yjs provider.
 * Implemented in this folder; the rest of the app uses only these exports.
 */
import type * as Y from 'yjs'
import type { GameId, PlayerPubkey } from '@/core/ids'
import type { IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'

export interface Identity {
  pubkey: PlayerPubkey
  /** Sign an unsigned nostr event. Backed by a local key or a NIP-07 extension. */
  sign(event: unknown): Promise<unknown>
  /** NIP-44 conversation key derivation against another pubkey. */
  conversationKey(peer: PlayerPubkey): Promise<Uint8Array>
}

export interface GameConnectionOptions {
  relays: string[]
  identity: Identity
  gameId: GameId
  /** 32-byte symmetric game key from the invite link. */
  gameKey: Uint8Array
  isGm: boolean
}

export interface GameConnection {
  doc: Y.Doc
  gameId: GameId
  gm: PlayerPubkey
  isGm: boolean
  status: 'connecting' | 'connected' | 'offline'
  /** Non-GM: send an intent to the GM. GM: delivered to `onIntent`. */
  sendIntent(intent: IntentEnvelope): void
  onIntent(cb: (intent: IntentEnvelope) => void): () => void
  publishPresence(p: Presence): void
  onPresence(cb: (p: Presence) => void): () => void
  onStatus(cb: (s: GameConnection['status']) => void): () => void
  /** Encode an invite link (naddr + game key fragment). */
  inviteLink(): string
  close(): void
}

export interface InviteInfo {
  gameId: GameId
  gm: PlayerPubkey
  relays: string[]
  gameKey: Uint8Array
}

export { parseInvite, createGame, joinGame, loadIdentity, DEFAULT_RELAYS } from './impl'
