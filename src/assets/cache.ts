/** Raw IndexedDB blob cache. Two stores: `blobs` (bytes) and `meta` (size + LRU stamp, cheap to scan). */
export interface CacheMeta {
  sha256: string
  size: number
  lastAccess: number
}

export interface BlobCache {
  get(sha256: string): Promise<Blob | undefined>
  put(sha256: string, blob: Blob): Promise<void>
  stats(): Promise<{ count: number; bytes: number }>
  evict(maxBytes: number): Promise<{ evicted: number; freedBytes: number }>
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })
}

export function openBlobCache(dbName: string): BlobCache {
  let dbp: Promise<IDBDatabase> | undefined
  const db = () =>
    (dbp ??= new Promise<IDBDatabase>((res, rej) => {
      const open = indexedDB.open(dbName, 1)
      open.onupgradeneeded = () => {
        open.result.createObjectStore('blobs')
        open.result.createObjectStore('meta', { keyPath: 'sha256' })
      }
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    }).catch((e) => {
      dbp = undefined
      throw e
    }))

  return {
    async get(sha256) {
      const d = await db()
      const blob = (await req(d.transaction('blobs').objectStore('blobs').get(sha256))) as Blob | undefined
      if (!blob) return undefined
      const tx = d.transaction('meta', 'readwrite')
      const store = tx.objectStore('meta')
      const meta = (await req(store.get(sha256))) as CacheMeta | undefined
      store.put({ sha256, size: meta?.size ?? blob.size, lastAccess: Date.now() } satisfies CacheMeta)
      await done(tx)
      return blob
    },
    async put(sha256, blob) {
      const d = await db()
      const tx = d.transaction(['blobs', 'meta'], 'readwrite')
      tx.objectStore('blobs').put(blob, sha256)
      tx.objectStore('meta').put({ sha256, size: blob.size, lastAccess: Date.now() } satisfies CacheMeta)
      await done(tx)
    },
    async stats() {
      const d = await db()
      const all = (await req(d.transaction('meta').objectStore('meta').getAll())) as CacheMeta[]
      return { count: all.length, bytes: all.reduce((n, m) => n + m.size, 0) }
    },
    async evict(maxBytes) {
      const d = await db()
      const all = (await req(d.transaction('meta').objectStore('meta').getAll())) as CacheMeta[]
      let total = all.reduce((n, m) => n + m.size, 0)
      all.sort((a, b) => a.lastAccess - b.lastAccess)
      const victims: CacheMeta[] = []
      for (const m of all) {
        if (total <= maxBytes) break
        victims.push(m)
        total -= m.size
      }
      if (victims.length) {
        const tx = d.transaction(['blobs', 'meta'], 'readwrite')
        for (const v of victims) {
          tx.objectStore('blobs').delete(v.sha256)
          tx.objectStore('meta').delete(v.sha256)
        }
        await done(tx)
      }
      return { evicted: victims.length, freedBytes: victims.reduce((n, m) => n + m.size, 0) }
    },
  }
}
