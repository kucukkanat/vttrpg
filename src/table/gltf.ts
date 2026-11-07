/**
 * The one GLB loader for everything on the table: props, tokens, scenes (and kits later).
 *
 * Every loader carries the same three decoders, all bundled with the app so nothing is fetched
 * from a third-party CDN:
 *   - Draco (KHR_draco_mesh_compression): the decoder three ships under `examples/jsm/libs/draco`,
 *     which Vite emits next to the app and the loader fetches on first use;
 *   - meshopt (EXT_meshopt_compression): `examples/jsm/libs/meshopt_decoder`, a small inline wasm;
 *   - KTX2 / Basis (KHR_texture_basisu): the transcoder under `examples/jsm/libs/basis`. It needs a
 *     renderer to pick a GPU format, so it is attached only when one is passed.
 *
 * The decoders are created once and shared (each Draco and KTX2 loader runs its own worker pool).
 * This module is imported by the table only, so it stays out of the startup chunk.
 *
 * `loadGltf` also measures what it loaded (triangles, texture memory, file bytes) and keeps the
 * figures per asset hash for `getModelStats`; `overBudget` says when a model is too heavy for a prop.
 */
import { LoaderUtils, Mesh, Texture, type LoadingManager, type Object3D, type WebGLRenderer } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/** The minimum a KTX2 loader needs from a renderer to detect compressed texture support. */
export type TextureRenderer = Pick<WebGLRenderer, 'extensions'>

export interface GltfLoaderOptions {
  /** Enables KTX2/Basis textures (GPU format detection needs it). */
  renderer?: TextureRenderer
  /** Directory of a Draco decoder to use instead of the bundled one. */
  dracoDecoderPath?: string
  /** Directory of a Basis transcoder to use instead of the bundled one. */
  ktx2TranscoderPath?: string
  /** Loading manager for the GLTF loader itself (the import pipeline serves files from memory). */
  manager?: LoadingManager
}

const dracoLoaders = new Map<string, DRACOLoader>()
const ktx2Loaders = new Map<string, KTX2Loader>()

function dracoLoader(path: string | undefined): DRACOLoader {
  const key = path ?? ''
  let l = dracoLoaders.get(key)
  if (!l) {
    l = new DRACOLoader()
    if (path) l.setDecoderPath(path)
    dracoLoaders.set(key, l)
  }
  return l
}

function ktx2Loader(path: string | undefined, renderer: TextureRenderer): KTX2Loader {
  const key = path ?? ''
  let l = ktx2Loaders.get(key)
  if (!l) {
    l = new KTX2Loader()
    if (path) l.setTranscoderPath(path)
    l.detectSupport(renderer as WebGLRenderer)
    ktx2Loaders.set(key, l)
  }
  return l
}

/** A GLTFLoader with Draco, meshopt and (given a renderer) KTX2 attached. */
export function createGltfLoader(opts: GltfLoaderOptions = {}): GLTFLoader {
  const loader = new GLTFLoader(opts.manager)
  loader.setDRACOLoader(dracoLoader(opts.dracoDecoderPath))
  loader.setMeshoptDecoder(MeshoptDecoder)
  if (opts.renderer) loader.setKTX2Loader(ktx2Loader(opts.ktx2TranscoderPath, opts.renderer))
  return loader
}

// ---------------------------------------------------------------------------------------------
// Budget

export interface ModelStats {
  triangles: number
  /** Estimated GPU memory of the model's textures, mip chains included. */
  textureBytes: number
  /** Size of the file as downloaded. */
  bytes: number
  meshes: number
  textures: number
}

/** A prop or mini above either figure gets a warning for the GM. */
export const MODEL_BUDGET = { triangles: 50_000, bytes: 20 * 1024 * 1024 } as const

/** Counts what a loaded model costs: triangles over visible meshes, unique textures' memory. */
export function measureModel(root: Object3D, bytes: number): ModelStats {
  let triangles = 0
  let meshes = 0
  const textures = new Set<Texture>()
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    meshes++
    const g = o.geometry
    const count = g.index ? g.index.count : (g.attributes.position?.count ?? 0)
    triangles += Math.floor(count / 3)
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v)
    }
  })
  let textureBytes = 0
  for (const t of textures) textureBytes += textureMemory(t)
  return { triangles, textureBytes, bytes, meshes, textures: textures.size }
}

function textureMemory(t: Texture): number {
  // Compressed textures carry their mip levels as byte arrays; images expand to RGBA8 plus mips.
  const mips = (t as { mipmaps?: Array<{ data?: ArrayBufferView }> }).mipmaps
  if (mips && mips.length && mips[0]?.data) return mips.reduce((n, m) => n + (m.data?.byteLength ?? 0), 0)
  const img = t.image as { width?: number; height?: number } | undefined
  const w = img?.width ?? 0
  const h = img?.height ?? 0
  return Math.round(w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1))
}

/** Plain-language reasons a model is over the prop budget; empty when it fits. */
export function overBudget(s: ModelStats, budget = MODEL_BUDGET): string[] {
  const out: string[] = []
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  if (s.triangles > budget.triangles) out.push(`${s.triangles.toLocaleString('en')} triangles (budget ${budget.triangles.toLocaleString('en')})`)
  if (s.bytes > budget.bytes) out.push(`a ${mb(s.bytes)} file (budget ${mb(budget.bytes)})`)
  if (s.textureBytes > budget.bytes) out.push(`${mb(s.textureBytes)} of textures (budget ${mb(budget.bytes)})`)
  return out
}

const stats = new Map<string, ModelStats>()

/** What a model loaded on this client costs, by asset hash; undefined until it has loaded. */
export function getModelStats(sha256: string): ModelStats | undefined {
  return stats.get(sha256)
}

// ---------------------------------------------------------------------------------------------
// Loading

export interface LoadGltfOptions extends GltfLoaderOptions {
  /** Asset hash; the stats are recorded under it. */
  sha256?: string
}

export interface LoadedGltf {
  gltf: GLTF
  stats: ModelStats
}

/** Fetches and parses one GLB, measuring it. Not cached: the caller owns the result. */
export async function loadGltf(url: string, opts: LoadGltfOptions = {}): Promise<LoadedGltf> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load ${url}: HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  const base = url.startsWith('blob:') || url.startsWith('data:') ? '' : LoaderUtils.extractUrlBase(url)
  const gltf = await createGltfLoader(opts).parseAsync(buffer, base)
  const s = measureModel(gltf.scene, buffer.byteLength)
  if (opts.sha256) stats.set(opts.sha256, s)
  return { gltf, stats: s }
}

interface CacheEntry {
  promise: Promise<LoadedGltf>
  value?: LoadedGltf
  error?: unknown
}

const models = new Map<string, CacheEntry>()

/**
 * Shared, cached model load for props and minis. Keyed by asset hash when known (content
 * addressed, so two object URLs of one file share a parse), else by URL. Callers clone
 * `gltf.scene`; geometry and materials are shared and never disposed.
 */
export function loadModel(url: string, opts: LoadGltfOptions = {}): CacheEntry {
  const key = opts.sha256 ?? url
  let e = models.get(key)
  if (!e) {
    const entry: CacheEntry = { promise: loadGltf(url, opts) }
    entry.promise.then((v) => { entry.value = v }, (err: unknown) => { entry.error = err })
    models.set(key, entry)
    e = entry
  }
  return e
}

/** Suspense read of `loadModel`: returns the model, or throws the pending promise or the error. */
export function readModel(url: string, opts: LoadGltfOptions = {}): LoadedGltf {
  const e = loadModel(url, opts)
  if (e.value) return e.value
  if (e.error !== undefined) throw e.error
  throw e.promise
}

/** Forget cached models (tests). */
export function clearModelCache(): void {
  models.clear()
  stats.clear()
}
