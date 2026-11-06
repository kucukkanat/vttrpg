import type { AssetRef } from '@/core/assets'
import type { AssetResolver } from './index'
import { openBlobCache, type BlobCache } from './cache'
import { sha256Hex, inferKind, inferMime } from './hash'
import { buildUploadAuthEvent, describeHttpError, encodeAuthHeader, normalizeServer } from './blossom'

export const DEFAULT_BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://cdn.satellite.earth']

export interface LibraryEntry {
  sha256: string
  path: string
  kind: string
  mime: string
  size: number
  name: string
  license: string
}

export interface ResolverOptions {
  /** Base URL of the shipped library, e.g. `${import.meta.env.BASE_URL}library`. Contains index.json. */
  libraryBase: string
  /** Called while bytes download from the network (library, pasted URLs, Blossom). */
  onProgress?: (ref: AssetRef, loaded: number, total: number) => void
  /** Blossom servers tried last as `<server>/<sha256>`. */
  blossomServers?: string[]
  /** IndexedDB database name. Override in tests. */
  dbName?: string
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function pushUnique(sources: string[], url: string): string[] {
  return sources.includes(url) ? sources : [...sources, url]
}

export function createAssetResolver(opts: ResolverOptions): AssetResolver {
  const libraryBase = opts.libraryBase.replace(/\/+$/, '')
  const blossomServers = (opts.blossomServers ?? DEFAULT_BLOSSOM_SERVERS).map(normalizeServer)
  const cache: BlobCache = openBlobCache(opts.dbName ?? 'vttrpg-assets')

  const urls = new Map<string, { url: string; count: number }>()
  const inflight = new Map<string, Promise<string>>()
  let libraryIndex: Promise<Map<string, LibraryEntry>> | undefined

  // Cache failures (private mode, quota) must never break resolving.
  const cacheGet = (h: string) => cache.get(h).catch(() => undefined)
  const cachePut = (h: string, b: Blob) => cache.put(h, b).catch(() => undefined)

  function loadLibrary(): Promise<Map<string, LibraryEntry>> {
    return (libraryIndex ??= (async () => {
      try {
        const res = await fetch(`${libraryBase}/index.json`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const list = (await res.json()) as LibraryEntry[]
        return new Map(list.map((e) => [e.sha256, e]))
      } catch (e) {
        libraryIndex = undefined // retry on next resolve
        console.warn(`assets: library index unavailable (${errMsg(e)})`)
        return new Map<string, LibraryEntry>()
      }
    })())
  }

  async function download(ref: AssetRef, url: string): Promise<Blob> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || ref.size
    let blob: Blob
    if (opts.onProgress && res.body) {
      const reader = res.body.getReader()
      const parts: Uint8Array<ArrayBuffer>[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value as Uint8Array<ArrayBuffer>)
        loaded += value.byteLength
        opts.onProgress(ref, loaded, total)
      }
      blob = new Blob(parts, { type: ref.mime })
    } else {
      blob = new Blob([await res.arrayBuffer()], { type: ref.mime })
    }
    const got = await sha256Hex(blob)
    if (got !== ref.sha256) throw new Error(`hash mismatch (got ${got.slice(0, 12)}...)`)
    return blob
  }

  /** Walks the source order (cache, library, ref.sources, Blossom defaults) and returns verified bytes. */
  async function loadBlob(ref: AssetRef): Promise<Blob> {
    const cached = await cacheGet(ref.sha256)
    // A corrupted cache entry falls through to the network.
    if (cached && (await sha256Hex(cached)) === ref.sha256) return new Blob([cached], { type: ref.mime })

    const candidates: string[] = []
    const entry = (await loadLibrary()).get(ref.sha256)
    if (entry) candidates.push(`${libraryBase}/${entry.path.replace(/^\/+/, '')}`)
    candidates.push(...ref.sources)
    candidates.push(...blossomServers.map((s) => `${s}/${ref.sha256}`))

    const failures: string[] = []
    for (const url of new Set(candidates)) {
      try {
        const blob = await download(ref, url)
        await cachePut(ref.sha256, blob)
        return blob
      } catch (e) {
        failures.push(`${url}: ${errMsg(e)}`)
      }
    }
    throw new Error(
      `assets: could not resolve ${ref.sha256}${ref.name ? ` (${ref.name})` : ''}. Tried:\n${failures.join('\n')}`,
    )
  }

  function resolve(ref: AssetRef): Promise<string> {
    const key = ref.sha256
    const hit = urls.get(key)
    if (hit) {
      hit.count++
      return Promise.resolve(hit.url)
    }
    let p = inflight.get(key)
    if (!p) {
      p = loadBlob(ref)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          urls.set(key, { url, count: 0 })
          return url
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    return p.then((url) => {
      const e = urls.get(key)
      if (e) e.count++
      return url
    })
  }

  async function importFile(file: File): Promise<AssetRef> {
    const sha256 = await sha256Hex(file)
    const mime = inferMime(file.name, file.type)
    await cachePut(sha256, new Blob([file], { type: mime }))
    return { sha256, kind: inferKind(file.name, mime), mime, size: file.size, name: file.name, sources: [] }
  }

  async function addUrlSource(ref: AssetRef, url: string): Promise<AssetRef> {
    let blob: Blob
    try {
      blob = await download(ref, url)
    } catch (e) {
      throw new Error(`assets: ${url} does not serve this file (${errMsg(e)})`)
    }
    await cachePut(ref.sha256, blob)
    return { ...ref, sources: pushUnique(ref.sources, url) }
  }

  async function uploadToBlossom(
    ref: AssetRef,
    server: string,
    signer: (event: unknown) => Promise<unknown>,
  ): Promise<AssetRef> {
    const base = normalizeServer(server)
    const blob = await loadBlob(ref)
    const signed = await signer(buildUploadAuthEvent(ref.sha256, ref.name))
    if (!signed || typeof signed !== 'object' || !('sig' in signed) || !('id' in signed)) {
      throw new Error('assets: signer did not return a signed event (missing id/sig)')
    }
    let res: Response
    try {
      res = await fetch(`${base}/upload`, {
        method: 'PUT',
        headers: {
          Authorization: encodeAuthHeader(signed),
          'Content-Type': ref.mime,
          'X-SHA-256': ref.sha256,
        },
        body: blob,
      })
    } catch (e) {
      throw new Error(`Blossom ${base} is unreachable (${errMsg(e)})`)
    }
    if (!res.ok) throw new Error(await describeHttpError(base, res))
    let descriptor: { url?: unknown; sha256?: unknown }
    try {
      descriptor = (await res.json()) as typeof descriptor
    } catch {
      throw new Error(`Blossom ${base} returned an unreadable blob descriptor`)
    }
    if (descriptor.sha256 !== ref.sha256) {
      throw new Error(`Blossom ${base} stored different bytes (descriptor sha256 ${String(descriptor.sha256)})`)
    }
    const url = typeof descriptor.url === 'string' ? descriptor.url : `${base}/${ref.sha256}`
    return { ...ref, sources: pushUnique(ref.sources, url) }
  }

  function release(ref: AssetRef): void {
    const e = urls.get(ref.sha256)
    if (!e) return
    if (--e.count > 0) return
    URL.revokeObjectURL(e.url)
    urls.delete(ref.sha256)
  }

  return {
    resolve,
    importFile,
    uploadToBlossom,
    addUrlSource,
    release,
    stats: () => cache.stats(),
    evict: (maxBytes) => cache.evict(maxBytes),
  }
}
