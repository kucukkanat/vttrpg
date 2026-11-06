/**
 * Local copy of each game in IndexedDB: the whole Yjs state as one update plus
 * the decrypted manifest. The GM device is self-sufficient with it (a game
 * survives reloads even when no relay kept the manifest) and rejoin can show
 * the table before the relays answer. Falls back to memory when IndexedDB is
 * unavailable (private mode, tests without the shim).
 */
import type { GameId } from '@/core/ids'
import type { Manifest } from './codec'

export interface LocalGameRecord {
  gameId: GameId
  /** Y.encodeStateAsUpdate(doc) at `savedAt`. */
  update?: Uint8Array
  /** created_at of the newest delta folded into `update`; replay resumes from here. */
  lastDeltaAt?: number
  manifest?: Manifest
  savedAt: number
}

export interface LocalGameStore {
  load(gameId: GameId): Promise<LocalGameRecord | undefined>
  saveDoc(gameId: GameId, update: Uint8Array, lastDeltaAt?: number): Promise<void>
  saveManifest(gameId: GameId, manifest: Manifest): Promise<void>
  remove(gameId: GameId): Promise<void>
}

export const LOCAL_DB_NAME = 'vttrpg-games'
const STORE = 'games'

function openDb(name: string): Promise<IDBDatabase> | null {
  let idb: IDBFactory | undefined
  try {
    idb = globalThis.indexedDB
  } catch {
    idb = undefined
  }
  if (!idb) return null
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'gameId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onblocked = () => reject(new Error('indexedDB open blocked'))
  })
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('indexedDB request failed'))
  })
}

export function createMemoryGameStore(): LocalGameStore {
  const m = new Map<string, LocalGameRecord>()
  return {
    async load(gameId) {
      return m.get(gameId)
    },
    async saveDoc(gameId, update, lastDeltaAt) {
      m.set(gameId, { ...(m.get(gameId) ?? { gameId }), gameId, update, lastDeltaAt, savedAt: Date.now() })
    },
    async saveManifest(gameId, manifest) {
      m.set(gameId, { ...(m.get(gameId) ?? { gameId }), gameId, manifest, savedAt: Date.now() })
    },
    async remove(gameId) {
      m.delete(gameId)
    },
  }
}

export function openLocalGameStore(dbName = LOCAL_DB_NAME): LocalGameStore {
  const dbp = openDb(dbName)
  if (!dbp) return createMemoryGameStore()
  const memory = createMemoryGameStore()
  // Any IndexedDB failure (quota, private mode mid-session) degrades to memory for the rest of the session.
  let broken = false
  const db = dbp.catch((e) => {
    console.warn('net: local game store unavailable, keeping games in memory', e)
    broken = true
    return null
  })

  async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    const d = await db
    if (!d || broken) return fallback()
    try {
      const tx = d.transaction(STORE, mode)
      const result = await fn(tx.objectStore(STORE))
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'))
      })
      return result
    } catch (e) {
      console.warn('net: local game store error, falling back to memory', e)
      broken = true
      return fallback()
    }
  }

  const merge = (store: IDBObjectStore, gameId: GameId, patch: Partial<LocalGameRecord>) =>
    request(store.get(gameId)).then((existing: LocalGameRecord | undefined) => {
      const next: LocalGameRecord = { ...(existing ?? { gameId, savedAt: 0 }), ...patch, gameId, savedAt: Date.now() }
      return request(store.put(next)).then(() => undefined)
    })

  return {
    load: (gameId) =>
      withStore(
        'readonly',
        (s) => request(s.get(gameId)) as Promise<LocalGameRecord | undefined>,
        () => memory.load(gameId),
      ),
    saveDoc: (gameId, update, lastDeltaAt) =>
      withStore(
        'readwrite',
        (s) => merge(s, gameId, { update, lastDeltaAt }),
        () => memory.saveDoc(gameId, update, lastDeltaAt),
      ),
    saveManifest: (gameId, manifest) =>
      withStore(
        'readwrite',
        (s) => merge(s, gameId, { manifest }),
        () => memory.saveManifest(gameId, manifest),
      ),
    remove: (gameId) =>
      withStore(
        'readwrite',
        (s) => request(s.delete(gameId)).then(() => undefined),
        () => memory.remove(gameId),
      ),
  }
}

let shared: LocalGameStore | undefined
/** The app-wide store (one IndexedDB database per origin). */
export function localGameStore(): LocalGameStore {
  return (shared ??= openLocalGameStore())
}
