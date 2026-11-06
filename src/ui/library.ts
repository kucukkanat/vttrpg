/** Reads the starter library index shipped with the site and turns entries into AssetRefs. */
import type { AssetKind, AssetRef } from '@/core/assets'
import type { AssetHash } from '@/core/ids'
import type { LibraryEntry } from '@/assets'

export const LIBRARY_BASE = import.meta.env.BASE_URL + 'library/'

let cache: Promise<LibraryEntry[]> | null = null
export function loadLibraryIndex(): Promise<LibraryEntry[]> {
  cache ??= fetch(LIBRARY_BASE + 'index.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
  return cache
}

export function libraryRef(e: LibraryEntry): AssetRef {
  return {
    sha256: e.sha256 as AssetHash,
    kind: e.kind as AssetKind,
    mime: e.mime,
    size: e.size,
    name: e.name,
    sources: [new URL(LIBRARY_BASE + e.path, window.location.href).toString()],
  }
}

/**
 * Display name for a library file: "forest-clearing.glb" -> "Forest clearing". Separators become
 * spaces, the first letter is capitalised and the rest is left alone (so "Old Mill" stays).
 */
export function titleCase(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base ? base[0]!.toUpperCase() + base.slice(1) : fileName
}
