/**
 * Registry of games this device has opened, kept in localStorage so a reload
 * (or a later visit) can rejoin them. Holds the invite link, which carries the
 * game key, but never the Nostr secret key: identity persists that itself.
 */
import type { GameId, PlayerPubkey } from '@/core/ids'

export const GAMES_STORAGE_KEY = 'vttrpg.games'

export interface SavedGame {
  gameId: GameId
  naddr: string
  /** Full invite link: naddr plus the game key in the fragment. */
  invite: string
  name: string
  isGm: boolean
  gm: PlayerPubkey
  relays: string[]
  /** Unix ms. */
  lastOpened: number
  pack: string
  /** Display name used last time; optional, so rejoin can skip the form. */
  displayName?: string
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const memory = new Map<string, string>()
const memoryStore: Store = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
}

function defaultStore(): Store {
  try {
    const ls = globalThis.localStorage
    if (ls) return ls
  } catch {
    // privacy mode or not a browser
  }
  return memoryStore
}

/** Pulls the `naddr1...` out of an invite link; empty when it does not look like one. */
export function naddrFromInvite(invite: string): string {
  const m = /(naddr1[02-9ac-hj-np-z]+)/i.exec(invite)
  return m ? m[1] : ''
}

export interface GamesRegistry {
  list(): SavedGame[]
  get(gameId: GameId): SavedGame | undefined
  /** Adds or replaces an entry; `lastOpened` defaults to now. */
  remember(game: Omit<SavedGame, 'lastOpened'> & { lastOpened?: number }): SavedGame
  /** Updates `lastOpened` (and any patch) for a known game; no-op when unknown. */
  touch(gameId: GameId, patch?: Partial<Omit<SavedGame, 'gameId'>>): SavedGame | undefined
  forget(gameId: GameId): void
  /** Most recently opened game, if any. */
  mostRecent(): SavedGame | undefined
  /** Fires after every change; returns an unsubscribe. */
  subscribe(cb: () => void): () => void
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function sanitize(v: unknown): SavedGame | null {
  if (!isRecord(v)) return null
  if (typeof v.gameId !== 'string' || typeof v.invite !== 'string' || typeof v.gm !== 'string') return null
  return {
    gameId: v.gameId as GameId,
    naddr: typeof v.naddr === 'string' ? v.naddr : naddrFromInvite(v.invite),
    invite: v.invite,
    name: typeof v.name === 'string' ? v.name : '',
    isGm: v.isGm === true,
    gm: v.gm as PlayerPubkey,
    relays: Array.isArray(v.relays) ? v.relays.filter((r): r is string => typeof r === 'string') : [],
    lastOpened: typeof v.lastOpened === 'number' ? v.lastOpened : 0,
    pack: typeof v.pack === 'string' ? v.pack : '',
    displayName: typeof v.displayName === 'string' ? v.displayName : undefined,
  }
}

const byRecency = (a: SavedGame, b: SavedGame) => b.lastOpened - a.lastOpened

export function createGamesRegistry(opts: { store?: Store; key?: string; now?: () => number } = {}): GamesRegistry {
  const store = opts.store ?? defaultStore()
  const key = opts.key ?? GAMES_STORAGE_KEY
  const now = opts.now ?? Date.now
  const listeners = new Set<() => void>()

  function read(): SavedGame[] {
    try {
      const raw = store.getItem(key)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.map(sanitize).filter((g): g is SavedGame => g !== null).sort(byRecency)
    } catch {
      return []
    }
  }

  function write(games: SavedGame[]) {
    try {
      store.setItem(key, JSON.stringify([...games].sort(byRecency)))
    } catch (e) {
      console.warn('games: could not persist registry', e)
    }
    for (const cb of listeners) cb()
  }

  return {
    list: read,
    get: (gameId) => read().find((g) => g.gameId === gameId),
    remember(game) {
      const entry: SavedGame = {
        ...game,
        naddr: game.naddr || naddrFromInvite(game.invite),
        lastOpened: game.lastOpened ?? now(),
      }
      write([entry, ...read().filter((g) => g.gameId !== game.gameId)])
      return entry
    },
    touch(gameId, patch) {
      const games = read()
      const i = games.findIndex((g) => g.gameId === gameId)
      if (i < 0) return undefined
      const next: SavedGame = { ...games[i], ...patch, gameId, lastOpened: now() }
      games[i] = next
      write(games)
      return next
    },
    forget(gameId) {
      write(read().filter((g) => g.gameId !== gameId))
    },
    mostRecent: () => read()[0],
    subscribe(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
  }
}

/** The app-wide registry over localStorage. */
export const games: GamesRegistry = createGamesRegistry()

// --- rejoin decision -------------------------------------------------------------------------

export type RejoinDecision =
  | { role: 'gm' }
  | { role: 'player'; notice?: string }
  | { role: 'error'; message: string }

/**
 * Decides how a rejoined connection should be used once the doc has been replayed.
 * `connectionIsGm` is what net granted (saved role AND manifest gm matches us);
 * `metaGm` is `meta.gm` read from the restored doc, undefined when the doc is empty.
 */
export function decideRejoin(input: { saved: Pick<SavedGame, 'isGm' | 'name'>; pubkey: string; connectionIsGm: boolean; metaGm: string | undefined }): RejoinDecision {
  const { saved, pubkey, connectionIsGm, metaGm } = input
  if (metaGm === undefined) {
    return { role: 'error', message: `Could not restore "${saved.name || 'the game'}" from the relays. Check your connection and try again.` }
  }
  if (!saved.isGm) return { role: 'player' }
  if (connectionIsGm && metaGm === pubkey) return { role: 'gm' }
  return {
    role: 'player',
    notice: 'This device is no longer the GM of this game (the identity does not match), so you rejoined as a player.',
  }
}

export function formatLastOpened(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms)
  const min = Math.round(d / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 7) return `${days} d ago`
  return new Date(ms).toLocaleDateString()
}
