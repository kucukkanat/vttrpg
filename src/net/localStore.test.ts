import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { GameId, PlayerPubkey } from '@/core/ids'
import type { Manifest } from './codec'
import { createMemoryGameStore, openLocalGameStore } from './localStore'

const gm = 'a'.repeat(64) as PlayerPubkey
const manifest: Manifest = { name: 'Local', gm, relays: ['wss://x'], snapshot: { url: 'https://b/x', sha256: 'ff', at: 10 } }

for (const [label, make] of [
  ['IndexedDB', () => openLocalGameStore(`test-${crypto.randomUUID()}`)],
  ['memory', () => createMemoryGameStore()],
] as const) {
  describe(`local game store (${label})`, () => {
    it('round-trips the doc update, lastDeltaAt and manifest, merging the two writes', async () => {
      const store = make()
      const gameId = crypto.randomUUID() as GameId
      expect(await store.load(gameId)).toBeUndefined()

      const doc = new Y.Doc()
      doc.getMap('meta').set('name', 'Local')
      doc.getMap('tokens').set('t1', { hp: 3 })
      await store.saveDoc(gameId, Y.encodeStateAsUpdate(doc), 1234)
      await store.saveManifest(gameId, manifest)

      const rec = await store.load(gameId)
      expect(rec?.gameId).toBe(gameId)
      expect(rec?.lastDeltaAt).toBe(1234)
      expect(rec?.manifest).toEqual(manifest)
      expect(rec?.savedAt).toBeGreaterThan(0)
      const back = new Y.Doc()
      Y.applyUpdate(back, rec!.update!)
      expect(back.getMap('meta').get('name')).toBe('Local')
      expect(back.getMap('tokens').get('t1')).toEqual({ hp: 3 })

      // A later doc save keeps the manifest and vice versa.
      doc.getMap('tokens').set('t2', { hp: 1 })
      await store.saveDoc(gameId, Y.encodeStateAsUpdate(doc), 2000)
      const rec2 = await store.load(gameId)
      expect(rec2?.manifest).toEqual(manifest)
      expect(rec2?.lastDeltaAt).toBe(2000)
      await store.saveManifest(gameId, { ...manifest, name: 'Renamed' })
      const rec3 = await store.load(gameId)
      expect(rec3?.manifest?.name).toBe('Renamed')
      expect(rec3?.update).toEqual(rec2?.update)

      await store.remove(gameId)
      expect(await store.load(gameId)).toBeUndefined()
    })

    it('keeps games apart by id', async () => {
      const store = make()
      const a = crypto.randomUUID() as GameId
      const b = crypto.randomUUID() as GameId
      await store.saveManifest(a, manifest)
      await store.saveManifest(b, { ...manifest, name: 'B' })
      expect((await store.load(a))?.manifest?.name).toBe('Local')
      expect((await store.load(b))?.manifest?.name).toBe('B')
    })
  })
}

describe('local game store without IndexedDB', () => {
  it('falls back to memory instead of throwing', async () => {
    const saved = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true })
    try {
      const store = openLocalGameStore('ignored')
      const gameId = crypto.randomUUID() as GameId
      await store.saveManifest(gameId, manifest)
      expect((await store.load(gameId))?.manifest).toEqual(manifest)
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: saved, configurable: true })
    }
  })
})
