import type { AssetCipher, AssetRef } from '@/core/assets'
import type { AssetHash } from '@/core/ids'
import { decryptBlob, encryptBlob } from '@/core/blobCrypto'
import type { AssetResolver } from './index'
import { openBlobCache, type BlobCache } from './cache'
import { sha256Hex, inferKind, inferMime } from './hash'
import { normalizeServer, putBlob, putBlobWithRetry, type BlossomSigner } from './blossom'
import { getAssetStatus, setAssetRetry, setAssetStatus } from './status'

export const DEFAULT_BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://cdn.satellite.earth']

/** MIME type sent with ciphertext uploads; the real type stays on the (encrypted) ref. */
const CIPHER_MIME = 'application/octet-stream'

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
  /** Blossom servers tried last as `<server>/<sha256>` (or `<server>/<enc.sha256>` for encrypted refs). */
  blossomServers?: string[]
  /** IndexedDB database name. Override in tests. */
  dbName?: string
  /**
   * Lets `shareFile` upload. Without it `shareFile` only stores the file locally. `servers` defaults
   * to `blossomServers`; uploads go to the first server that accepts them.
   */
  uploader?: { sign: BlossomSigner; servers?: string[] }
  /** Pauses between upload retries (see `UPLOAD_RETRY_DELAYS_MS`). Override in tests. */
  retryDelaysMs?: number[]
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
  const uploadServers = (opts.uploader?.servers ?? blossomServers).map(normalizeServer)
  const cache: BlobCache = openBlobCache(opts.dbName ?? 'vttrpg-assets')

  const urls = new Map<string, { url: string; count: number }>()
  const inflight = new Map<string, Promise<string>>()
  // Bytes from importFile that could not be written to IndexedDB (private mode, quota). Session only.
  const unpersisted = new Map<string, Blob>()
  // Plaintext hash -> the key it was shared under this session, so sharing a file twice reuses one
  // ciphertext (the same Blossom blob) instead of uploading a second copy under a new key.
  const ciphers = new Map<string, AssetCipher>()
  // Plaintext hash -> the running upload.
  const uploads = new Map<string, Promise<void>>()
  let libraryIndex: Promise<Map<string, LibraryEntry>> | undefined

  // Cache failures (private mode, quota) must never break resolving.
  const cacheGet = (h: string) => cache.get(h).catch(() => undefined)
  const cachePut = (h: string, b: Blob) =>
    cache.put(h, b).then(
      () => true,
      () => false,
    )

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

  /** Downloads `url` and checks the bytes hash to `expect`. */
  async function download(ref: AssetRef, url: string, expect: string, mime: string): Promise<Blob> {
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
      blob = new Blob(parts, { type: mime })
    } else {
      blob = new Blob([await res.arrayBuffer()], { type: mime })
    }
    const got = await sha256Hex(blob)
    if (got !== expect) throw new Error(`hash mismatch (got ${got.slice(0, 12)}...)`)
    return blob
  }

  /** Downloads ciphertext, checks its hash, decrypts, then checks the plaintext hash. */
  async function downloadEncrypted(ref: AssetRef, enc: AssetCipher, url: string): Promise<Blob> {
    const sealed = await download(ref, url, enc.sha256, CIPHER_MIME)
    const plain = await decryptBlob(new Uint8Array(await sealed.arrayBuffer()), enc.key)
    const got = await sha256Hex(plain)
    if (got !== ref.sha256) throw new Error(`decrypted bytes do not match the asset (got ${got.slice(0, 12)}...)`)
    return new Blob([plain], { type: ref.mime })
  }

  /** Walks the source order (cache, library, ref.sources, Blossom defaults) and returns verified plaintext. */
  async function loadBlob(ref: AssetRef): Promise<Blob> {
    const cached = await cacheGet(ref.sha256)
    // A corrupted cache entry falls through to the network.
    if (cached && (await sha256Hex(cached)) === ref.sha256) return new Blob([cached], { type: ref.mime })
    const local = unpersisted.get(ref.sha256)
    if (local) return local

    const candidates: { url: string; get: () => Promise<Blob> }[] = []
    const entry = (await loadLibrary()).get(ref.sha256)
    if (entry) {
      const url = `${libraryBase}/${entry.path.replace(/^\/+/, '')}`
      candidates.push({ url, get: () => download(ref, url, ref.sha256, ref.mime) })
    }
    const enc = ref.enc
    if (enc) {
      for (const url of new Set([...ref.sources, ...blossomServers.map((s) => `${s}/${enc.sha256}`)])) {
        candidates.push({ url, get: () => downloadEncrypted(ref, enc, url) })
      }
    } else {
      for (const url of new Set([...ref.sources, ...blossomServers.map((s) => `${s}/${ref.sha256}`)])) {
        candidates.push({ url, get: () => download(ref, url, ref.sha256, ref.mime) })
      }
    }

    const failures: string[] = []
    for (const c of candidates) {
      try {
        const blob = await c.get()
        await cachePut(ref.sha256, blob)
        return blob
      } catch (e) {
        failures.push(`${c.url}: ${errMsg(e)}`)
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
    const blob = new Blob([file], { type: mime })
    if (await cachePut(sha256, blob)) unpersisted.delete(sha256)
    else unpersisted.set(sha256, blob)
    if (!getAssetStatus(sha256)) setAssetStatus(sha256, { status: 'local' })
    return { sha256, kind: inferKind(file.name, mime), mime, size: file.size, name: file.name, sources: [] }
  }

  /** The ciphertext Blossom stores for `ref`, re-derived from the plaintext and checked against `enc.sha256`. */
  async function sealedBytes(ref: AssetRef & { enc: AssetCipher }): Promise<Blob> {
    const plain = new Uint8Array(await (await loadBlob(ref)).arrayBuffer())
    const { ciphertext } = await encryptBlob(plain, ref.enc.key)
    if ((await sha256Hex(ciphertext)) !== ref.enc.sha256) throw new Error('assets: re-encrypted bytes do not match the shared copy')
    return new Blob([ciphertext], { type: CIPHER_MIME })
  }

  /** Background upload with retries; the status store follows it. One run per asset at a time. */
  function startUpload(ref: AssetRef & { enc: AssetCipher }, body?: Blob): Promise<void> {
    const sha = ref.sha256
    const running = uploads.get(sha)
    if (running) return running
    const uploader = opts.uploader
    if (!uploader) return Promise.reject(new Error('assets: this resolver cannot upload (no signer)'))
    setAssetRetry(sha, undefined)
    setAssetStatus(sha, { status: 'uploading', attempts: 0 })
    const run = (async () => {
      const bytes = body ?? (await sealedBytes(ref))
      await putBlobWithRetry(uploadServers, bytes, {
        sha256: ref.enc.sha256,
        mime: CIPHER_MIME,
        // No file name: the signed auth event is public, and the name would say what the blob is.
        sign: uploader.sign,
        delaysMs: opts.retryDelaysMs,
        onAttempt: (attempts, error) => setAssetStatus(sha, { status: 'uploading', attempts, ...(error ? { error } : {}) }),
      })
    })()
      .then(
        () => {
          setAssetStatus(sha, { status: 'shared' })
        },
        (e: unknown) => {
          const error = errMsg(e)
          console.warn(`assets: upload of ${ref.name ?? sha} failed: ${error}`)
          setAssetStatus(sha, { status: 'failed', error })
          setAssetRetry(sha, () => void startUpload(ref).catch(() => {}))
          throw e
        },
      )
      .finally(() => uploads.delete(sha))
    uploads.set(sha, run)
    return run
  }

  async function shareFile(file: File): Promise<AssetRef> {
    const ref = await importFile(file)
    if (!opts.uploader) return ref
    const plain = new Uint8Array(await file.arrayBuffer())
    const known = ciphers.get(ref.sha256)
    const { ciphertext, key } = await encryptBlob(plain, known?.key)
    const enc: AssetCipher = known ?? { sha256: (await sha256Hex(ciphertext)) as AssetHash, key }
    ciphers.set(ref.sha256, enc)
    const shared: AssetRef & { enc: AssetCipher } = { ...ref, enc, sources: uploadServers.map((s) => `${s}/${enc.sha256}`) }
    if (getAssetStatus(ref.sha256)?.status !== 'shared') {
      // Callers place the ref at once; players resolve it as soon as the upload lands.
      startUpload(shared, new Blob([ciphertext], { type: CIPHER_MIME })).catch(() => {})
    }
    return shared
  }

  function reshare(ref: AssetRef): Promise<void> {
    const enc = ref.enc
    if (!enc) return Promise.reject(new Error('assets: only encrypted refs can be re-shared'))
    return startUpload({ ...ref, enc })
  }

  function whenShared(ref: AssetRef): Promise<void> {
    return uploads.get(ref.sha256) ?? (getAssetStatus(ref.sha256)?.status === 'shared' ? Promise.resolve() : Promise.reject(new Error('assets: no upload running for this asset')))
  }

  async function addUrlSource(ref: AssetRef, url: string): Promise<AssetRef> {
    let blob: Blob
    try {
      blob = ref.enc ? await downloadEncrypted(ref, ref.enc, url) : await download(ref, url, ref.sha256, ref.mime)
    } catch (e) {
      throw new Error(`assets: ${url} does not serve this file (${errMsg(e)})`)
    }
    await cachePut(ref.sha256, blob)
    return { ...ref, sources: pushUnique(ref.sources, url) }
  }

  async function uploadToBlossom(ref: AssetRef, server: string, signer: BlossomSigner): Promise<AssetRef> {
    const enc = ref.enc
    const body = enc ? await sealedBytes({ ...ref, enc }) : await loadBlob(ref)
    const url = await putBlob(server, body, {
      sha256: enc ? enc.sha256 : ref.sha256,
      mime: enc ? CIPHER_MIME : ref.mime,
      name: enc ? undefined : ref.name,
      sign: signer,
    })
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
    shareFile,
    reshare,
    whenShared,
    uploadToBlossom,
    addUrlSource,
    release,
    stats: () => cache.stats(),
    evict: (maxBytes) => cache.evict(maxBytes),
  }
}
