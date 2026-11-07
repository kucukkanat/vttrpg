/**
 * Sketchfab client: search without a login, download with the GM's personal API token.
 *
 * Search: `GET https://api.sketchfab.com/v3/search?type=models&downloadable=true&license=<slug>`.
 * The API echoes the page's origin in CORS headers. It honours only one `license` value per
 * request, so "all allowed licences" runs one search per licence (cc0, by, by-sa) and interleaves
 * the pages. Results carry the licence as `{ uid, label }`; licence.ts maps it to ours.
 *
 * Download: `GET /v3/models/{uid}/download` with `Authorization: Token <token>` returns short-lived
 * (300 s) presigned S3 URLs for `glb`, `gltf` (zip), `usdz` and `source`. Checked live on
 * 7 Nov 2026: the endpoint answers CORS for the site's origin, and the presigned file URLs send
 * `Access-Control-Allow-Origin: *`, so the browser fetches the file directly. The token is never
 * sent to the file host.
 *
 * The token lives only in this browser's localStorage (`vtt.sketchfab.token`); it never enters
 * the game document, the GLB, the catalogue entry or a log line.
 */
import type { LicenceId } from '@/core/catalogue'
import { LICENCE_LABELS } from '@/core/catalogue'
import { fetchBytes } from './download'
import { mapSketchfabLicence } from './licence'
import { guessCategory } from './normalise'
import { ModelImportError, type ImportMeta, type InputFile, type PreparedModel, type PrepareOptions, type ProgressCallback } from './types'

export const SKETCHFAB_API = 'https://api.sketchfab.com/v3'
export const SKETCHFAB_TOKEN_KEY = 'vtt.sketchfab.token'
/** Where the GM finds their API token. */
export const SKETCHFAB_TOKEN_HELP = 'https://sketchfab.com/settings/password'
/** Archives above this size get a warning before download. */
export const SKETCHFAB_WARN_BYTES = 30 * 1024 * 1024
export const SKETCHFAB_CREDIT = 'Models provided by Sketchfab'

/** Licence filter for search; `all` means every importable licence. */
export type SketchfabLicenceFilter = 'all' | 'cc0' | 'cc-by' | 'cc-by-sa'

const FILTER_SLUGS: Record<Exclude<SketchfabLicenceFilter, 'all'>, string> = { cc0: 'cc0', 'cc-by': 'by', 'cc-by-sa': 'by-sa' }

type Fetch = typeof fetch
type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// ---------------------------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------------------------

function defaultStorage(): TokenStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function getSketchfabToken(storage: TokenStorage | undefined = defaultStorage()): string | null {
  try { return storage?.getItem(SKETCHFAB_TOKEN_KEY)?.trim() || null } catch { return null }
}

/** Stores the token in this browser only. An empty value forgets it. */
export function setSketchfabToken(token: string, storage: TokenStorage | undefined = defaultStorage()): boolean {
  const t = token.trim()
  if (!t) return forgetSketchfabToken(storage)
  try { storage?.setItem(SKETCHFAB_TOKEN_KEY, t); return !!storage } catch { return false }
}

export function forgetSketchfabToken(storage: TokenStorage | undefined = defaultStorage()): boolean {
  try { storage?.removeItem(SKETCHFAB_TOKEN_KEY); return true } catch { return false }
}

/** Personal API tokens are 32 hex characters; this only catches obvious paste mistakes. */
export function looksLikeToken(t: string): boolean {
  return /^[A-Za-z0-9]{20,64}$/.test(t.trim())
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

export interface SketchfabArchive {
  size: number
  faceCount?: number
  textureCount?: number
  textureMaxResolution?: number
}

export interface SketchfabModel {
  uid: string
  title: string
  author: string
  authorUrl?: string
  licence: LicenceId
  licenceLabel: string
  pageUrl: string
  thumbnail?: string
  faceCount: number
  vertexCount?: number
  animated: boolean
  glb?: SketchfabArchive
  gltf?: SketchfabArchive
  tags: string[]
  categories: string[]
}

interface RawImage { url?: string; width?: number; height?: number }
interface RawArchive { size?: number; faceCount?: number | null; textureCount?: number | null; textureMaxResolution?: number | null }
interface RawModel {
  uid?: string
  name?: string
  viewerUrl?: string
  faceCount?: number
  vertexCount?: number
  animationCount?: number
  isDownloadable?: boolean
  license?: { uid?: string; slug?: string; label?: string; uri?: string } | null
  user?: { username?: string; displayName?: string; profileUrl?: string }
  thumbnails?: { images?: RawImage[] }
  archives?: { glb?: RawArchive | null; gltf?: RawArchive | null }
  tags?: Array<{ name?: string; slug?: string }>
  categories?: Array<{ name?: string; slug?: string }>
}

/** The thumbnail closest to card size: the smallest at least `min` px wide, else the largest. */
export function pickThumbnail(images: RawImage[] | undefined, min = 360): string | undefined {
  const ok = (images ?? []).filter((i) => i?.url && (i.width ?? 0) > 0).sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (ok.find((i) => (i.width ?? 0) >= min) ?? ok[ok.length - 1])?.url
}

function archive(a: RawArchive | null | undefined): SketchfabArchive | undefined {
  if (!a || typeof a.size !== 'number') return undefined
  return { size: a.size, faceCount: a.faceCount ?? undefined, textureCount: a.textureCount ?? undefined, textureMaxResolution: a.textureMaxResolution ?? undefined }
}

/** Parses one search page; drops models that are not downloadable or not under an importable licence. */
export function parseSketchfabSearch(json: unknown): { results: SketchfabModel[]; next?: string } {
  const page = json as { results?: RawModel[]; next?: string | null } | null
  const results: SketchfabModel[] = []
  for (const r of page?.results ?? []) {
    if (!r?.uid || r.isDownloadable === false) continue
    const licence = mapSketchfabLicence(r.license)
    if (!licence) continue
    const author = r.user?.displayName || r.user?.username || 'Unknown'
    results.push({
      uid: r.uid,
      title: r.name?.trim() || 'Untitled',
      author,
      authorUrl: r.user?.profileUrl,
      licence,
      licenceLabel: LICENCE_LABELS[licence],
      pageUrl: r.viewerUrl || `https://sketchfab.com/3d-models/${r.uid}`,
      thumbnail: pickThumbnail(r.thumbnails?.images),
      faceCount: r.archives?.glb?.faceCount ?? r.faceCount ?? 0,
      vertexCount: r.vertexCount,
      animated: (r.animationCount ?? 0) > 0,
      glb: archive(r.archives?.glb),
      gltf: archive(r.archives?.gltf),
      tags: (r.tags ?? []).map((t) => t.name || t.slug || '').filter(Boolean),
      categories: (r.categories ?? []).map((c) => c.name || c.slug || '').filter(Boolean),
    })
  }
  const next = typeof page?.next === 'string' && page.next.startsWith(`${SKETCHFAB_API}/search`) ? page.next : undefined
  return { results, next }
}

export interface SketchfabSearchOptions {
  licence?: SketchfabLicenceFilter
  /** Skip models with more faces than this (Sketchfab's `max_face_count`). */
  maxFaces?: number
  sort?: 'relevance' | 'likes' | 'views' | 'recent'
  count?: number
  signal?: AbortSignal
  fetch?: Fetch
}

/** Opaque cursor for "load more": the next-page URL of each licence's search. */
export type SketchfabCursor = Record<string, string>

const SORTS: Record<NonNullable<SketchfabSearchOptions['sort']>, string | undefined> = {
  relevance: undefined, likes: '-likeCount', views: '-viewCount', recent: '-publishedAt',
}

export function sketchfabSearchUrl(query: string, slug: string, opts: SketchfabSearchOptions = {}): string {
  const p = new URLSearchParams({ type: 'models', downloadable: 'true', license: slug, count: String(opts.count ?? 24) })
  if (query.trim()) p.set('q', query.trim())
  if (opts.maxFaces) p.set('max_face_count', String(opts.maxFaces))
  const sort = SORTS[opts.sort ?? 'relevance']
  if (sort) p.set('sort_by', sort)
  return `${SKETCHFAB_API}/search?${p}`
}

async function apiJson(url: string, f: Fetch, init: RequestInit = {}): Promise<unknown> {
  let res: Response
  try {
    res = await f(url, init)
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new ModelImportError('cancelled', 'Cancelled.')
    throw new ModelImportError('network', 'Sketchfab could not be reached. Check the connection and try again.')
  }
  if (res.ok) return res.json()
  if (res.status === 401) throw new ModelImportError('auth', 'Sketchfab did not accept the API token. Copy it again from your Sketchfab settings (Password & API).')
  if (res.status === 403) throw new ModelImportError('auth', 'Sketchfab does not allow this account to download that model.')
  if (res.status === 404) throw new ModelImportError('network', 'Sketchfab could not find that model, or it is no longer downloadable.')
  if (res.status === 429) throw new ModelImportError('network', 'Sketchfab is limiting requests. Wait a minute and try again.')
  throw new ModelImportError('network', `Sketchfab answered ${res.status}. Try again later.`)
}

/**
 * Searches downloadable models under importable licences. Pass the returned cursor back to get
 * the next page; it is null when every licence's results are exhausted.
 */
export async function searchSketchfab(query: string, opts: SketchfabSearchOptions & { cursor?: SketchfabCursor } = {}): Promise<{ results: SketchfabModel[]; cursor: SketchfabCursor | null }> {
  const f = opts.fetch ?? fetch
  const filter = opts.licence ?? 'all'
  const slugs = filter === 'all' ? Object.values(FILTER_SLUGS) : [FILTER_SLUGS[filter]]
  const count = filter === 'all' ? Math.ceil((opts.count ?? 24) / slugs.length) : opts.count ?? 24
  const urls: SketchfabCursor = opts.cursor ?? Object.fromEntries(slugs.map((s) => [s, sketchfabSearchUrl(query, s, { ...opts, count })]))
  const pages = await Promise.all(Object.entries(urls).map(async ([slug, url]) => ({ slug, page: parseSketchfabSearch(await apiJson(url, f, { signal: opts.signal })) })))
  const results: SketchfabModel[] = []
  const seen = new Set<string>()
  for (let i = 0; pages.some((p) => i < p.page.results.length); i++) {
    for (const p of pages) {
      const r = p.page.results[i]
      if (r && !seen.has(r.uid)) { seen.add(r.uid); results.push(r) }
    }
  }
  const next: SketchfabCursor = {}
  for (const p of pages) if (p.page.next) next[p.slug] = p.page.next
  return { results, cursor: Object.keys(next).length ? next : null }
}

// ---------------------------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------------------------

/** The archive the importer will download: GLB when offered, else the glTF zip. */
export function downloadArchive(m: Pick<SketchfabModel, 'glb' | 'gltf'>): { kind: 'glb' | 'gltf'; size: number } | undefined {
  if (m.glb) return { kind: 'glb', size: m.glb.size }
  if (m.gltf) return { kind: 'gltf', size: m.gltf.size }
  return undefined
}

export function needsSizeWarning(m: Pick<SketchfabModel, 'glb' | 'gltf'>): boolean {
  return (downloadArchive(m)?.size ?? 0) > SKETCHFAB_WARN_BYTES
}

export interface SketchfabDownloadLinks {
  glb?: { url: string; size?: number; expires?: number }
  gltf?: { url: string; size?: number; expires?: number }
}

export function parseDownloadLinks(json: unknown): SketchfabDownloadLinks {
  const out: SketchfabDownloadLinks = {}
  for (const k of ['glb', 'gltf'] as const) {
    const v = (json as Record<string, { url?: string; size?: number; expires?: number }> | null)?.[k]
    if (v?.url && /^https:\/\//.test(v.url)) out[k] = { url: v.url, size: v.size, expires: v.expires }
  }
  return out
}

/** Asks Sketchfab for the temporary download URLs of a model, with the GM's token. */
export async function getSketchfabDownloadLinks(uid: string, token: string, opts: { signal?: AbortSignal; fetch?: Fetch } = {}): Promise<SketchfabDownloadLinks> {
  if (!token) throw new ModelImportError('auth', 'Add your Sketchfab API token to download models.')
  if (!/^[a-f0-9]{32}$/i.test(uid)) throw new ModelImportError('network', 'That is not a Sketchfab model id.')
  const json = await apiJson(`${SKETCHFAB_API}/models/${uid}/download`, opts.fetch ?? fetch, {
    headers: { Authorization: `Token ${token}` },
    signal: opts.signal,
  })
  return parseDownloadLinks(json)
}

/**
 * Downloads a model's GLB (or glTF zip). The token goes only to api.sketchfab.com; the presigned
 * file URL is fetched without credentials.
 */
export async function downloadSketchfabModel(
  model: Pick<SketchfabModel, 'uid' | 'title'>,
  token: string,
  opts: { onProgress?: ProgressCallback; signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<InputFile[]> {
  opts.onProgress?.({ stage: 'download', progress: 0.01, message: 'Asking Sketchfab for the download' })
  const links = await getSketchfabDownloadLinks(model.uid, token, opts)
  const pick = links.glb ? { kind: 'glb' as const, ...links.glb } : links.gltf ? { kind: 'gltf' as const, ...links.gltf } : undefined
  if (!pick) throw new ModelImportError('unsupported', 'Sketchfab offers no GLB or glTF download for this model.')
  const total = pick.size || 0
  let bytes: Uint8Array
  try {
    bytes = await fetchBytes(pick.url, {
      fetch: opts.fetch,
      signal: opts.signal,
      onBytes: (n) => opts.onProgress?.({
        stage: 'download',
        progress: total ? Math.min(1, n / total) * 0.3 : 0.1,
        message: `Downloading from Sketchfab (${(n / 1048576).toFixed(1)}${total ? ` of ${(total / 1048576).toFixed(1)}` : ''} MB)`,
      }),
    })
  } catch (e) {
    if (e instanceof ModelImportError && e.code === 'network') {
      throw new ModelImportError('network', `${e.message} If this keeps happening, the file host may be blocking browser downloads (CORS); download the model from its Sketchfab page and use Upload instead.`)
    }
    throw e
  }
  return [{ name: `${model.uid}.${pick.kind === 'glb' ? 'glb' : 'zip'}`, bytes }]
}

/** Import metadata for a Sketchfab model. Carries author, licence and model page; never the token. */
export function sketchfabMeta(model: SketchfabModel): ImportMeta {
  return {
    origin: 'sketchfab',
    sourceId: model.uid,
    title: model.title,
    category: guessCategory([model.title, ...model.categories, ...model.tags]),
    tags: [...new Set(model.tags.map((t) => t.toLowerCase()))].slice(0, 12),
    licence: { id: model.licence, author: model.author, authorUrl: model.authorUrl, source: 'Sketchfab', sourceUrl: model.pageUrl },
  }
}

/** Downloads a Sketchfab model with the GM's token and runs it through the pipeline (loaded on demand). */
export async function importFromSketchfab(model: SketchfabModel, token: string, opts: PrepareOptions & { fetch?: Fetch } = {}): Promise<PreparedModel> {
  const files = await downloadSketchfabModel(model, token, opts)
  const { prepareModel } = await import('./pipeline')
  return prepareModel(files, sketchfabMeta(model), {
    ...opts,
    onProgress: (p) => opts.onProgress?.({ ...p, progress: 0.3 + p.progress * 0.7 }),
  })
}
