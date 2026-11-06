/**
 * Sync layer: Nostr identity, game rooms, NIP-44 encryption, Yjs provider.
 * Implemented in this folder; the rest of the app uses only these exports.
 */
import type * as Y from 'yjs'
import type { GameId, PlayerPubkey } from '@/core/ids'
import type { IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { LocalGameStore } from './localStore'

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
  /** Local copy store; defaults to the app-wide IndexedDB store. */
  local?: LocalGameStore
}

export interface GameConnection {
  doc: Y.Doc
  gameId: GameId
  gm: PlayerPubkey
  isGm: boolean
  status: 'connecting' | 'connected' | 'offline'
  /** Relays this connection was opened with. */
  relays: string[]
  /** Number of relays with an open socket right now (for a "3/4 relays" indicator). */
  relayCount: number
  /** Non-GM: send an intent to the GM. GM: delivered to `onIntent`. */
  sendIntent(intent: IntentEnvelope): void
  onIntent(cb: (intent: IntentEnvelope) => void): () => void
  publishPresence(p: Presence): void
  onPresence(cb: (p: Presence) => void): () => void
  onStatus(cb: (s: GameConnection['status']) => void): () => void
  /** Encode an invite link (naddr + game key fragment). */
  inviteLink(): string
  /** Full Yjs state as one update, for uploading as a snapshot. */
  snapshot(): Uint8Array
  /** GM only: republish the manifest pointing at an uploaded snapshot so late joiners skip the delta replay. */
  publishSnapshotPointer(url: string, sha256: string): Promise<void>
  /** True when the doc was restored from this device's local copy (the relay replay then runs behind it). */
  hasLocalCopy: boolean
  close(): void
}

export interface InviteInfo {
  gameId: GameId
  gm: PlayerPubkey
  relays: string[]
  gameKey: Uint8Array
}

export { parseInvite, createGame, joinGame, loadIdentity, DEFAULT_RELAYS } from './impl'
export { currentProfile, profileSuffix } from './identity'
export { startSnapshotLoop, createSnapshotLoop, SNAPSHOT_INTERVAL_MS, SNAPSHOT_MAX_DELTAS, EVENT_PRUNE_AFTER_MS } from './snapshots'
export type { SnapshotLoop, SnapshotLoopOptions } from './snapshots'
export { localGameStore, openLocalGameStore, createMemoryGameStore } from './localStore'
export type { LocalGameStore, LocalGameRecord } from './localStore'
