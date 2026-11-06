/**
 * Public entry points of the sync layer. The heavy lifting lives in
 * `codec.ts` (pure encoding), `identity.ts`, `pool.ts` and `connection.ts`.
 */
import { newId, type GameId } from '@/core/ids'
import type { GameConnection, GameConnectionOptions, InviteInfo } from './index'
import { decodeInvite, randomGameKey, type Manifest } from './codec'
import { fetchManifest, openConnection } from './connection'
import { createPool, type PoolLike } from './pool'
import { localGameStore } from './localStore'

export { loadIdentity } from './identity'

/** Net diagnostics go to the console; nothing here is user-facing. */
const log = (...a: unknown[]) => console.log(...a)

/** Public relays can take a while to answer a one-shot query on a cold socket. */
export const MANIFEST_TIMEOUT_MS = 20_000

export const DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]

export function parseInvite(url: string): InviteInfo | null {
  return decodeInvite(url)
}

/** GM: mints a game id and key, publishes the manifest and starts publishing deltas. */
export async function createGame(opts: Omit<GameConnectionOptions, 'gameId' | 'gameKey' | 'isGm'> & { name: string }): Promise<GameConnection> {
  const gameId = newId<'GameId'>() as GameId
  const gameKey = randomGameKey()
  const manifest: Manifest = { name: opts.name, gm: opts.identity.pubkey, relays: opts.relays }
  const { pool, tracker } = createPool(opts.relays, log)
  const local = opts.local ?? localGameStore()
  try {
    return await openConnection({ ...opts, gameId, gameKey, isGm: true, pool, tracker, manifest, fresh: true, local, log })
  } catch (e) {
    tracker.dispose()
    pool.destroy()
    throw e
  }
}

/** One retry: on a cold start some relays only come up after the first query's budget is spent. */
async function findManifest(pool: PoolLike, opts: GameConnectionOptions): Promise<Manifest> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await fetchManifest(pool, opts.relays, opts.gameKey, opts.gameId, MANIFEST_TIMEOUT_MS)).manifest
    } catch (e) {
      if (attempt >= 1) throw e
      log('net: manifest not found on the first pass, retrying once', e)
    }
  }
}

/** Player (or returning GM): finds the manifest, loads snapshot + deltas, then goes live. */
export async function joinGame(opts: GameConnectionOptions): Promise<GameConnection> {
  const local = opts.local ?? localGameStore()
  const saved = await local.load(opts.gameId).catch(() => undefined)
  const { pool, tracker } = createPool(opts.relays, log)
  try {
    // The local manifest makes the GM device self-sufficient (a GM never waits on a relay that may have
    // dropped the manifest) and lets players rejoin at once; a player with none asks the relays.
    let manifest = saved?.manifest
    if (manifest && opts.isGm && manifest.gm !== opts.identity.pubkey) manifest = undefined
    if (manifest) log('net: using the local manifest for', opts.gameId)
    else manifest = await findManifest(pool, opts)
    return await openConnection({ ...opts, pool, tracker, manifest, local, log })
  } catch (e) {
    tracker.dispose()
    pool.destroy()
    throw e
  }
}
