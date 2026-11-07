/**
 * Poly Haven client: live search of the CC0 model catalogue and download of a glTF set, which then
 * runs through the import pipeline.
 *
 * API: https://api.polyhaven.com (no key; `Access-Control-Allow-Origin: *` on the API and on
 * dl.polyhaven.org). Terms (https://polyhaven.com/our-api): free use, credit "Powered by Poly Haven",
 * and a unique User-Agent. Browsers do not let a page set User-Agent (and a custom header would
 * force a CORS preflight), so the header is only sent outside the browser (scripts, tests); in the
 * app the credit is shown in the dialog and the scene credits.
 *
 * The model list is one request (~500 entries) cached for the session; text search filters it
 * locally because the API has no query parameter.
 */
import type { Licence } from '@/core/catalogue'
import { fetchBytes } from './download'
import { guessCategory, type Vec3 } from './normalise'
import { MAX_IMPORT_BYTES, ModelImportError, type ImportMeta, type InputFile, type PreparedModel, type PrepareOptions, type ProgressCallback } from './types'

export const POLYHAVEN_API = 'https://api.polyhaven.com'
export const POLYHAVEN_CREDIT = 'Powered by Poly Haven'
export const POLYHAVEN_USER_AGENT = 'vttrpg-model-import/1.0 (+https://github.com/kucukkanat/vttrpg)'

export interface PolyHavenModel {
  id: string
  title: string
  categories: string[]
  tags: string[]
  authors: string[]
  /** Polygon count as published (quads may count once). */
  polycount?: number
  /** True size in metres from `dimensions` (published in millimetres): [x, y, z]. */
  dimensions?: Vec3
  thumbnail: string
  pageUrl: string
  downloads?: number
  published?: number
}

export interface PolyHavenFileSet {
  resolution: string
  gltfUrl: string
  /** Relative path inside the glTF → absolute URL. */
  include: Record<string, { url: string; size: number }>
  totalBytes: number
}

type Fetch = typeof fetch

function headers(): HeadersInit | undefined {
  return typeof window === 'undefined' ? { 'User-Agent': POLYHAVEN_USER_AGENT } : undefined
}

async function getJson<T>(url: string, f: Fetch, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await f(url, { headers: headers(), signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new ModelImportError('cancelled', 'Cancelled.')
    throw new ModelImportError('network', 'Poly Haven could not be reached. Check the connection and try again.')
  }
  if (!res.ok) throw new ModelImportError('network', `Poly Haven answered ${res.status}. Try again later.`)
  return (await res.json()) as T
}

interface RawAsset {
  name?: string
  type?: number
  categories?: string[]
  tags?: string[]
  authors?: Record<string, string>
  polycount?: number
  dimensions?: number[]
  thumbnail_url?: string
  download_count?: number
  date_published?: number
}

/** Parses `GET /assets?t=models` (an object keyed by asset id) into models, most downloaded first. */
export function parsePolyHavenAssets(json: unknown): PolyHavenModel[] {
  if (!json || typeof json !== 'object') return []
  const out: PolyHavenModel[] = []
  for (const [id, raw] of Object.entries(json as Record<string, RawAsset>)) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.type !== undefined && raw.type !== 2) continue // 2 = model
    const dims = Array.isArray(raw.dimensions) && raw.dimensions.length === 3 && raw.dimensions.every((d) => typeof d === 'number' && d > 0)
      ? (raw.dimensions.map((d) => Math.round(d) / 1000) as Vec3)
      : undefined
    out.push({
      id,
      title: raw.name || id,
      categories: (raw.categories ?? []).filter((c) => typeof c === 'string'),
      tags: (raw.tags ?? []).filter((t) => typeof t === 'string'),
      authors: Object.keys(raw.authors ?? {}),
      polycount: typeof raw.polycount === 'number' ? raw.polycount : undefined,
      dimensions: dims,
      thumbnail: raw.thumbnail_url || `https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(id)}.png?width=256&height=256`,
      pageUrl: `https://polyhaven.com/a/${encodeURIComponent(id)}`,
      downloads: raw.download_count,
      published: raw.date_published,
    })
  }
  return out.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
}

/** Parses `GET /categories/models` into `[name, count]`, collections and `all` left out. */
export function parsePolyHavenCategories(json: unknown): Array<{ id: string; count: number }> {
  if (!json || typeof json !== 'object') return []
  return Object.entries(json as Record<string, number>)
    .filter(([k, v]) => typeof v === 'number' && k !== 'all' && !k.startsWith('collection:'))
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Picks a glTF resolution from `GET /files/{id}`: the preferred one if offered, else the smallest
 * available above it, else the largest below. Returns undefined when the model has no glTF.
 */
export function parsePolyHavenFiles(json: unknown, prefer = '1k'): PolyHavenFileSet | undefined {
  const gltf = (json as { gltf?: Record<string, { gltf?: { url?: string; size?: number; include?: Record<string, { url?: string; size?: number }> } }> })?.gltf
  if (!gltf || typeof gltf !== 'object') return undefined
  const res = Object.keys(gltf).filter((k) => gltf[k]?.gltf?.url)
  if (!res.length) return undefined
  const px = (r: string) => parseFloat(r) || 0
  const want = px(prefer)
  const sorted = res.sort((a, b) => px(a) - px(b))
  const chosen = sorted.find((r) => r === prefer) ?? sorted.find((r) => px(r) >= want) ?? sorted[sorted.length - 1]
  const entry = gltf[chosen].gltf!
  const include: PolyHavenFileSet['include'] = {}
  let total = entry.size ?? 0
  for (const [path, f] of Object.entries(entry.include ?? {})) {
    if (!f?.url) continue
    include[path] = { url: f.url, size: f.size ?? 0 }
    total += f.size ?? 0
  }
  return { resolution: chosen, gltfUrl: entry.url!, include, totalBytes: total }
}

let cache: Promise<PolyHavenModel[]> | null = null

/** Every Poly Haven model (cached for the session). */
export function listPolyHavenModels(opts: { signal?: AbortSignal; fetch?: Fetch } = {}): Promise<PolyHavenModel[]> {
  const f = opts.fetch ?? fetch
  if (!cache || opts.fetch) {
    const p = getJson<unknown>(`${POLYHAVEN_API}/assets?t=models`, f, opts.signal).then(parsePolyHavenAssets)
    if (opts.fetch) return p
    cache = p
    p.catch(() => { cache = null })
  }
  return cache
}

export async function listPolyHavenCategories(opts: { signal?: AbortSignal; fetch?: Fetch } = {}): Promise<Array<{ id: string; count: number }>> {
  return parsePolyHavenCategories(await getJson<unknown>(`${POLYHAVEN_API}/categories/models`, opts.fetch ?? fetch, opts.signal))
}

/** Filters models by a free-text query (every word must match the title, id, tags or categories) and a category. */
export function filterPolyHaven(models: PolyHavenModel[], query: string, category?: string): PolyHavenModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return models.filter((m) => {
    if (category && !m.categories.includes(category)) return false
    if (!words.length) return true
    const hay = [m.title, m.id.replace(/_/g, ' '), ...m.tags, ...m.categories].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export async function searchPolyHaven(query: string, opts: { category?: string; signal?: AbortSignal; fetch?: Fetch } = {}): Promise<PolyHavenModel[]> {
  return filterPolyHaven(await listPolyHavenModels(opts), query, opts.category)
}

/** Downloads a model's glTF and its companions at the chosen resolution (1k by default). */
export async function downloadPolyHavenModel(
  model: Pick<PolyHavenModel, 'id'>,
  opts: { resolution?: string; onProgress?: ProgressCallback; signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<{ files: InputFile[]; set: PolyHavenFileSet }> {
  const f = opts.fetch ?? fetch
  const set = parsePolyHavenFiles(await getJson<unknown>(`${POLYHAVEN_API}/files/${encodeURIComponent(model.id)}`, f, opts.signal), opts.resolution ?? '1k')
  if (!set) throw new ModelImportError('unsupported', 'This Poly Haven model has no glTF download.')
  if (set.totalBytes > MAX_IMPORT_BYTES) throw new ModelImportError('too-large', 'This model is over the 100 MB limit at that resolution.')
  const jobs: Array<{ name: string; url: string; size: number }> = [
    { name: `${model.id}.gltf`, url: set.gltfUrl, size: 0 },
    ...Object.entries(set.include).map(([name, v]) => ({ name, url: v.url, size: v.size })),
  ]
  const done = new Map<string, number>()
  const total = Math.max(1, set.totalBytes)
  const files = await Promise.all(jobs.map(async (j) => ({
    name: j.name,
    bytes: await fetchBytes(j.url, {
      fetch: f,
      signal: opts.signal,
      headers: headers(),
      onBytes: (n) => {
        done.set(j.name, n)
        const sum = [...done.values()].reduce((a, b) => a + b, 0)
        opts.onProgress?.({ stage: 'download', progress: Math.min(1, sum / total) * 0.3, message: `Downloading from Poly Haven (${(sum / 1048576).toFixed(1)} MB)` })
      },
    }),
  })))
  return { files, set }
}

/** Import metadata for a Poly Haven model: CC0, source "Poly Haven", the asset page as sourceUrl. */
export function polyHavenMeta(model: PolyHavenModel): ImportMeta {
  const licence: Licence = { id: 'cc0', source: 'Poly Haven', sourceUrl: model.pageUrl }
  if (model.authors.length) licence.author = model.authors.join(', ')
  return {
    origin: 'polyhaven',
    sourceId: model.id,
    title: model.title,
    category: guessCategory([...model.categories, model.title, ...model.tags]),
    tags: [...new Set([...model.categories, ...model.tags])],
    licence,
    knownSize: model.dimensions,
  }
}

/** Downloads a Poly Haven model and runs it through the import pipeline (loaded on demand). */
export async function importFromPolyHaven(model: PolyHavenModel, opts: PrepareOptions & { resolution?: string; fetch?: Fetch } = {}): Promise<PreparedModel> {
  const { files } = await downloadPolyHavenModel(model, opts)
  const { prepareModel } = await import('./pipeline')
  return prepareModel(files, polyHavenMeta(model), {
    ...opts,
    onProgress: (p) => opts.onProgress?.({ ...p, progress: 0.3 + p.progress * 0.7 }),
  })
}
