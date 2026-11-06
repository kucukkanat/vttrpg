/**
 * Public entry points of the sync layer. The heavy lifting lives in
 * `codec.ts` (pure encoding), `identity.ts`, `pool.ts` and `connection.ts`.
 */
import { newId, type GameId } from '@/core/ids'
import type { GameConnection, GameConnectionOptions, InviteInfo } from './index'
import { decodeInvite, randomGameKey, type Manifest } from './codec'
import { fetchManifest, openConnection } from './connection'
import { createPool } from './pool'

export { loadIdentity } from './identity'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
]

export function parseInvite(url: string): InviteInfo | null {
  return decodeInvite(url)
}

/** GM: mints a game id and key, publishes the manifest and starts publishing deltas. */
export async function createGame(opts: Omit<GameConnectionOptions, 'gameId' | 'gameKey' | 'isGm'> & { name: string }): Promise<GameConnection> {
  const gameId = newId<'GameId'>() as GameId
  const gameKey = randomGameKey()
  const manifest: Manifest = { name: opts.name, gm: opts.identity.pubkey, relays: opts.relays }
  const { pool, tracker } = createPool(opts.relays)
  try {
    return await openConnection({ ...opts, gameId, gameKey, isGm: true, pool, tracker, manifest, fresh: true })
  } catch (e) {
    tracker.dispose()
    pool.destroy()
    throw e
  }
}

/** Player (or returning GM): finds the manifest, loads snapshot + deltas, then goes live. */
export async function joinGame(opts: GameConnectionOptions): Promise<GameConnection> {
  const { pool, tracker } = createPool(opts.relays)
  try {
    const { manifest } = await fetchManifest(pool, opts.relays, opts.gameKey, opts.gameId)
    return await openConnection({ ...opts, pool, tracker, manifest })
  } catch (e) {
    tracker.dispose()
    pool.destroy()
    throw e
  }
}
