/**
 * The model import pipeline (reports/Level design plan.md, Phase 3; research_notes/Level design/
 * model sources.md §4.6): files in, an optimised GLB, a thumbnail and a catalogue draft out.
 *
 *   prepareModel(files, meta)  → licence gate, convert, optimise, normalise, thumbnail
 *   (the GM confirms the real size in the UI)
 *   storeModel(prepared, assets, { scale }) → rescale if asked, store GLB + thumbnail, CatalogueEntry
 *
 * The heavy work runs in a module worker where the browser allows it and falls back to the main
 * thread. This module is loaded lazily (ImportDialog imports it with `import()`), so glTF Transform,
 * meshoptimizer and the three.js loaders never reach the startup bundle.
 */
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import type { AssetResolver } from '@/assets'
import { sha256Hex } from '@/assets/hash'
import { needsMainThreadConversion, runCore, type CoreRequest, type CoreResult } from './core'
import { convertToGlb } from './convert'
import { baseName, checkSize, collectModelSet } from './formats'
import { validateLicence } from './licence'
import { guessCategory } from './normalise'
import { rescaleGlb } from './optimise'
import type { CoreReply } from './pipeline.worker'
import {
  ModelImportError, TIER_BUDGETS, type CatalogueDraft, type ImportMeta, type ImportProgress, type ImportTier,
  type InputFile, type PreparedModel, type PrepareOptions,
} from './types'

export { TIER_BUDGETS }

/** Phone tier on small touch screens; desktop otherwise. */
export function detectTier(): ImportTier {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop'
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const small = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) < 820
  return coarse && small ? 'phone' : 'desktop'
}

/** Reads browser Files into the pipeline's in-memory form, rejecting oversize selections first. */
export async function readFiles(files: ArrayLike<File>): Promise<InputFile[]> {
  const list = Array.from(files)
  checkSize(list.reduce((n, f) => n + f.size, 0))
  return Promise.all(list.map(async (f) => ({
    name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    bytes: new Uint8Array(await f.arrayBuffer()),
  })))
}

function cancelled(): ModelImportError {
  return new ModelImportError('cancelled', 'Import cancelled.')
}

let seq = 0

/** Runs `runCore` in a worker; resolves undefined when the worker itself is unusable. */
function runInWorker(req: CoreRequest, onProgress: (f: number, m: string) => void, signal?: AbortSignal): Promise<CoreResult | undefined> {
  if (typeof Worker === 'undefined') return Promise.resolve(undefined)
  let worker: Worker
  try {
    worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve(undefined)
  }
  const id = ++seq
  return new Promise<CoreResult | undefined>((resolve, reject) => {
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', onAbort) }
    const onAbort = () => { finish(); reject(cancelled()) }
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (e: MessageEvent<CoreReply>) => {
      const m = e.data
      if (m.id !== id) return
      if ('progress' in m) return onProgress(m.progress.fraction, m.progress.message)
      finish()
      if ('result' in m) resolve(m.result)
      else if (m.error.internal) resolve(undefined) // retry on the main thread
      else reject(new ModelImportError(m.error.code, m.error.message))
    }
    worker.onerror = (e) => { e.preventDefault?.(); finish(); resolve(undefined) }
    worker.postMessage({ id, req })
  })
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model'
}

/**
 * Turns dropped or downloaded files into an optimised, normalised GLB with a thumbnail and a
 * catalogue draft. The licence is checked before any work. Throws ModelImportError.
 */
export async function prepareModel(files: InputFile[], meta: ImportMeta, opts: PrepareOptions = {}): Promise<PreparedModel> {
  const onProgress = opts.onProgress ?? (() => {})
  const progress = (p: ImportProgress) => { if (!opts.signal?.aborted) onProgress(p) }
  const check = () => { if (opts.signal?.aborted) throw cancelled() }
  const licence = validateLicence(meta.licence)
  const tier = opts.tier ?? detectTier()
  const sourceBytes = files.reduce((n, f) => n + f.bytes.byteLength, 0)
  checkSize(sourceBytes)

  progress({ stage: 'read', progress: 0.02, message: 'Reading files' })
  const set = await collectModelSet(files)
  check()
  const title = meta.title.trim() || baseName(set.main.name).replace(/\.[^.]+$/, '')
  const category = meta.category || guessCategory([title, ...(meta.tags ?? [])]) || 'decor'
  const zUp = opts.zUp ?? set.format === 'stl'

  const req: CoreRequest = {
    files: set.files,
    sourceFormat: set.format,
    options: { tier, zUp, title, licence, category, knownSize: meta.knownSize },
  }
  const warnings: string[] = []
  if (needsMainThreadConversion(set)) {
    progress({ stage: 'convert', progress: 0.05, message: `Converting ${set.format.toUpperCase()} to GLB` })
    req.convertedGlb = await convertToGlb(set, warnings)
    req.files = []
    check()
  }

  const coreProgress = (f: number, message: string) =>
    progress({ stage: f < 0.75 ? 'optimise' : 'normalise', progress: 0.1 + f * 0.75, message })
  let result = opts.useWorker === false ? undefined : await runInWorker(req, coreProgress, opts.signal)
  check()
  result ??= await runCore(req, coreProgress)
  check()

  progress({ stage: 'thumbnail', progress: 0.88, message: 'Rendering a thumbnail' })
  const render = opts.renderThumbnail ?? (await import('./thumbnail')).renderThumbnail
  const thumbnail = await render(result.glb)
  check()

  const sha = await sha256Hex(result.glb)
  const id = meta.origin === 'upload' || !meta.sourceId ? `upload:${sha}` : `${meta.origin}:${meta.sourceId}`
  const entry: CatalogueDraft = {
    id,
    origin: meta.origin,
    title,
    category,
    tags: [...new Set((meta.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20),
    ...(meta.theme ? { theme: meta.theme } : {}),
    size: result.size.map((v) => round3(v)) as [number, number, number],
    triangles: result.triangles,
    licence,
  }
  progress({ stage: 'thumbnail', progress: 0.95, message: 'Ready to confirm' })
  return {
    glb: result.glb,
    thumbnail,
    entry,
    sizeGuess: result.sizeGuess,
    stats: {
      sourceBytes,
      sourceTriangles: result.sourceTriangles,
      triangles: result.triangles,
      bytes: result.glb.byteLength,
      simplified: result.simplified,
      texturesResized: result.texturesResized,
      warnings: [...warnings, ...result.warnings],
    },
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

export interface StoreOptions {
  /** The GM's correction on top of the guess (2 = twice as big). Default 1. */
  scale?: number
  onProgress?: (p: ImportProgress) => void
}

/**
 * Applies the GM's real-size correction, then stores the GLB and the thumbnail through the assets
 * service and returns the finished catalogue entry. Uploading to Blossom and encryption are the
 * assets service's job; this only calls its public `importFile`.
 */
export async function storeModel(prepared: PreparedModel, assets: Pick<AssetResolver, 'importFile'>, opts: StoreOptions = {}): Promise<CatalogueEntry> {
  const factor = opts.scale ?? 1
  opts.onProgress?.({ stage: 'store', progress: 0.96, message: 'Saving the model' })
  const glb = factor === 1 ? prepared.glb : await rescaleGlb(prepared.glb, factor)
  const entry = { ...prepared.entry }
  entry.size = entry.size.map((v) => round3(v * factor)) as [number, number, number]
  if (entry.origin === 'upload' && factor !== 1) entry.id = `upload:${await sha256Hex(glb)}`
  const name = slug(entry.title)
  const model: AssetRef = await assets.importFile(new File([glb as BlobPart], `${name}.glb`, { type: 'model/gltf-binary' }))
  const ext = prepared.thumbnail.type === 'image/webp' ? 'webp' : prepared.thumbnail.type === 'image/jpeg' ? 'jpg' : 'png'
  const thumbnail: AssetRef = await assets.importFile(new File([prepared.thumbnail], `${name}.thumb.${ext}`, { type: prepared.thumbnail.type || 'image/webp' }))
  opts.onProgress?.({ stage: 'store', progress: 1, message: 'Added to the library' })
  return { ...entry, model, thumbnail }
}
