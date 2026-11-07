/**
 * At startup the GM's client sends again the models that never reached Blossom: My models
 * entries and props whose upload was still local, running or failed when the GM last left
 * (remembered by `assets/unshared.ts`). Loaded lazily by the shell, GM only.
 */
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import type { Prop } from '@/core/doc'
import { getAssetStatus, type AssetResolver } from '@/assets'
import { readUnshared, reshareCandidates } from '@/assets/unshared'
import { useGame } from '@/state/store'

/** Wait this long after the document arrives, so the table's own loads go first. */
const START_DELAY_MS = 3_000

/** Every model and thumbnail ref the game's own catalogue and props use. */
export function docRefs(s: { catalogue: Readonly<Record<string, CatalogueEntry>>; props: Readonly<Record<string, Prop>> }): AssetRef[] {
  const out: AssetRef[] = []
  for (const e of Object.values(s.catalogue)) {
    out.push(e.model)
    if (e.thumbnail && typeof e.thumbnail === 'object') out.push(e.thumbnail)
  }
  for (const p of Object.values(s.props)) out.push(p.model)
  return out
}

/** The refs to send again now. */
export function pendingReshares(s: Parameters<typeof docRefs>[0], unfinished: ReadonlySet<string> = readUnshared()): AssetRef[] {
  return reshareCandidates(docRefs(s), unfinished, (sha) => getAssetStatus(sha)?.status)
}

/** Once the document is in, re-shares what is pending, one upload at a time. Returns a cancel. */
export function reshareOnStart(assets: Pick<AssetResolver, 'reshare'>): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    for (const ref of pendingReshares(useGame.getState())) {
      if (cancelled) return
      await assets.reshare(ref).catch(() => { /* the status badge shows the failure and offers Retry */ })
    }
  }
  const start = () => { timer = setTimeout(() => void run(), START_DELAY_MS) }
  let off = () => {}
  if (useGame.getState().meta) start()
  else off = useGame.subscribe((s) => { if (s.meta) { off(); start() } })
  return () => { cancelled = true; off(); if (timer) clearTimeout(timer) }
}
