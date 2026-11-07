/**
 * The catalogue as React state: the built-in list (fetched once, on first use) and the game's
 * own models from the document ("My models"), plus picking an entry up for placement.
 */
import { catalogueParts } from '@/core/catalogueParts'
import { useEffect, useMemo, useState } from 'react'
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import { useGame } from '@/state/store'
import { pickUpModel } from '@/table/build/buildState'
import type { HeldModel } from '@/table/build/placement'
import { catalogueThumbnailUrl, loadBuiltinCatalogue } from '../catalogue'
import { catalogueIndex } from './libraryLogic'

let builtinCache: CatalogueEntry[] | null = null

/** The built-in catalogue, or null while it loads (or while `enabled` is false: nothing is fetched). */
export function useBuiltinCatalogue(enabled = true): CatalogueEntry[] | null {
  const [list, setList] = useState<CatalogueEntry[] | null>(builtinCache)
  useEffect(() => {
    if (!enabled) return
    // Loaded meanwhile by another user of the hook (this one mounted before it was enabled).
    if (builtinCache) { setList(builtinCache); return }
    let live = true
    void loadBuiltinCatalogue().then((l) => { builtinCache = l; if (live) setList(l) })
    return () => { live = false }
  }, [enabled])
  return list
}

/** The game's own models, newest titles sorted. */
export function useMyModels(): CatalogueEntry[] {
  const map = useGame((s) => s.catalogue)
  return useMemo(() => Object.values(map).sort((a, b) => a.title.localeCompare(b.title)), [map])
}

/** Every entry by id (built-in and the game's own). */
export function useCatalogueIndex(): Map<string, CatalogueEntry> {
  const builtin = useBuiltinCatalogue()
  const mine = useMyModels()
  return useMemo(() => catalogueIndex(builtin ?? [], mine), [builtin, mine])
}

/** What a click on a card puts in hand: the model at real size, unturned. */
export function heldFromEntry(e: CatalogueEntry): HeldModel {
  const fixtures = catalogueParts(e)
  return { catalogue: e.id, title: e.title, model: e.model, size: e.size, scale: { x: 1, y: 1, z: 1 }, ...(fixtures ? { fixtures } : {}) }
}

export function pickUpEntry(e: CatalogueEntry): void {
  pickUpModel(heldFromEntry(e))
}

/**
 * The card's thumbnail URL: a library path directly, an imported model's AssetRef through the
 * assets resolver (decrypted to a blob URL). Undefined while resolving or when there is none.
 */
export function useThumbnail(e: CatalogueEntry, resolve: (ref: AssetRef) => Promise<string>): string | undefined {
  const t = e.thumbnail
  const direct = typeof t === 'string' ? catalogueThumbnailUrl(e) : undefined
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!t || typeof t === 'string') return
    let live = true
    resolve(t).then((u) => { if (live) setUrl(u) }, () => { if (live) setUrl(undefined) })
    return () => { live = false }
  }, [t, resolve])
  return direct ?? url
}
