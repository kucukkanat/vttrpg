/**
 * Loaded kit manifests (public/library/kits/<kit>.json, built by scripts/make-library/kits.mjs).
 * Fetched once per kit and kept in a small store so the table re-renders when one arrives. No
 * three.js here: the controller reads it to block player moves through kit walls.
 */
import { create } from 'zustand'
import { BUILTIN_KITS, type KitManifest, type KitPiece, type SceneTiles } from '@/core/kits'
import { LIBRARY_BASE } from '@/ui/library'

interface KitStore {
  manifests: Record<string, KitManifest>
  put(m: KitManifest): void
}

export const useKitManifests = create<KitStore>((set) => ({
  manifests: {},
  put: (m) => set((s) => ({ manifests: { ...s.manifests, [m.id]: m } })),
}))

const loading = new Map<string, Promise<KitManifest | null>>()

/** Loads a kit's manifest once (resolves null for an unknown or unreachable kit). */
export function loadKitManifest(id: string): Promise<KitManifest | null> {
  const have = useKitManifests.getState().manifests[id]
  if (have) return Promise.resolve(have)
  let p = loading.get(id)
  if (!p) {
    p = fetch(`${LIBRARY_BASE}kits/${encodeURIComponent(id)}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<KitManifest>) : null))
      .then((m) => { if (m && m.id === id && Array.isArray(m.pieces)) { useKitManifests.getState().put(m); return m } return null })
      .catch(() => null)
    loading.set(id, p)
  }
  return p
}

export function loadBuiltinKits(): Promise<KitManifest[]> {
  return Promise.all(BUILTIN_KITS.map(loadKitManifest)).then((list) => list.filter((m): m is KitManifest => !!m))
}

/** Loads every kit a scene's table names. */
export function loadSceneKits(tiles: SceneTiles | undefined): void {
  for (const id of tiles?.kits ?? []) if (id) void loadKitManifest(id)
}

/** Resolves (kit index, piece index) of a scene to a manifest piece. */
export type PieceLookup = (kit: number, piece: number) => { manifest: KitManifest; piece: KitPiece } | null

export function pieceLookup(table: readonly (string | null)[], manifests: Record<string, KitManifest>): PieceLookup {
  return (kit, piece) => {
    const id = table[kit]
    const m = id ? manifests[id] : undefined
    const p = m?.pieces[piece]
    return m && p ? { manifest: m, piece: p } : null
  }
}

/** Index of a piece in its manifest by id (-1 when absent). */
export function pieceIndex(m: KitManifest, id: string | undefined): number {
  return id ? m.pieces.findIndex((p) => p.id === id) : -1
}
