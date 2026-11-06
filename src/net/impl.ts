// TODO(net session): implement. See src/net/index.ts for the contract and PLAN.md for the design.
import type { GameConnection, GameConnectionOptions, Identity, InviteInfo } from './index'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
]

export async function loadIdentity(): Promise<Identity> {
  throw new Error('net: not implemented')
}
export function parseInvite(_url: string): InviteInfo | null {
  throw new Error('net: not implemented')
}
export async function createGame(_opts: Omit<GameConnectionOptions, 'gameId' | 'gameKey' | 'isGm'> & { name: string }): Promise<GameConnection> {
  throw new Error('net: not implemented')
}
export async function joinGame(_opts: GameConnectionOptions): Promise<GameConnection> {
  throw new Error('net: not implemented')
}
