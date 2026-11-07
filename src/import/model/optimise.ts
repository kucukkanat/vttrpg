/**
 * The glTF Transform half of the pipeline: read a GLB or glTF set, optimise, normalise, embed the
 * licence and write a meshopt-compressed GLB. Runs in the import worker, or on the main thread when
 * workers are unavailable. Needs no DOM; textures are resized with OffscreenCanvas when the
 * environment has it (every current browser, also inside workers).
 *
 *   dedup → prune → weld → simplify (over the tier's triangle budget) → textures to WebP
 *   → Y up, metres, pivot at the bottom centre → asset.extras licence → meshopt
 */
import { Document, Logger, WebIO, type Node, type Primitive, type Scene } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, getBounds, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import type { Licence } from '@/core/catalogue'
import { findCompanion } from './formats'
import { attributionExtras, creditLine } from './licence'
import { guessRealSize, pivotOffset, Z_UP_TO_Y_UP, type Vec3 } from './normalise'
import { ModelImportError, TIER_BUDGETS, type ImportTier, type InputFile, type SizeGuess, type SourceFormat } from './types'

/** Name of the wrapper node holding the normalisation transform; `applyScale` finds it again. */
export const ROOT_NODE_NAME = 'vtt-root'

export interface OptimiseInput {
  /** A GLB (from the converter or a .glb file), or a glTF set with its companion files. */
  glb?: Uint8Array
  gltf?: { main: InputFile; files: InputFile[] }
  /** The original format, for the size heuristics (STL defaults to millimetres). */
  sourceFormat: SourceFormat
}

export interface OptimiseOptions {
  tier: ImportTier
  zUp: boolean
  title: string
  licence: Licence
  category?: string
  knownSize?: Vec3
  onProgress?: (fraction: number, message: string) => void
}

export interface OptimiseResult {
  glb: Uint8Array
  sourceTriangles: number
  triangles: number
  size: Vec3
  sizeGuess: SizeGuess
  simplified: boolean
  texturesResized: number
  warnings: string[]
}

let ioPromise: Promise<WebIO> | null = null

/** One shared WebIO with every extension and the meshopt codecs registered. */
export function getIO(): Promise<WebIO> {
  ioPromise ??= (async () => {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
    return new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
  })()
  return ioPromise
}

const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  KHR_texture_basisu: 'The model uses KTX2 textures, which import cannot read yet. Use a version with PNG or JPEG textures.',
  KHR_draco_mesh_compression: 'The model uses Draco compression; it must go through the converter first.',
}

async function readDocument(io: WebIO, input: OptimiseInput): Promise<Document> {
  const doc = await readDocumentRaw(io, input)
  doc.setLogger(new Logger(Logger.Verbosity.WARN))
  return doc
}

async function readDocumentRaw(io: WebIO, input: OptimiseInput): Promise<Document> {
  try {
    if (input.glb) return await io.readBinary(input.glb)
    if (!input.gltf) throw new ModelImportError('empty', 'Nothing to read.')
    const { main, files } = input.gltf
    let json: Record<string, unknown> & { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> }
    try {
      json = JSON.parse(new TextDecoder().decode(main.bytes))
    } catch {
      throw new ModelImportError('corrupt', 'The .gltf file is not valid JSON.')
    }
    const resources: Record<string, Uint8Array> = {}
    const missing: string[] = []
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      const uri = item.uri
      if (!uri || uri.startsWith('data:') || resources[uri]) continue
      const f = findCompanion(files, uri, main.name)
      if (f) resources[uri] = f.bytes
      else missing.push(uri)
    }
    if (missing.length) {
      throw new ModelImportError('missing-file', `The glTF needs files that were not included: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. Select them together with the .gltf, or drop a zip.`)
    }
    return await io.readJSON({ json: json as never, resources: resources as never })
  } catch (e) {
    if (e instanceof ModelImportError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    const ext = Object.keys(UNSUPPORTED_EXTENSIONS).find((k) => msg.includes(k))
    if (ext) throw new ModelImportError('unsupported', UNSUPPORTED_EXTENSIONS[ext])
    throw new ModelImportError('corrupt', `The model could not be read; it may be damaged (${msg.slice(0, 140)}).`)
  }
}

function primitiveTriangles(p: Primitive): number {
  const n = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0
  const mode = p.getMode()
  if (mode === 4) return Math.floor(n / 3)
  if (mode === 5 || mode === 6) return Math.max(0, n - 2)
  return 0
}

/** Triangles drawn by a scene: each mesh counted once per node that uses it. */
export function countTriangles(doc: Document): number {
  const scene = mainScene(doc)
  let total = 0
  const visit = (node: Node) => {
    const mesh = node.getMesh()
    if (mesh) for (const p of mesh.listPrimitives()) total += primitiveTriangles(p)
    for (const c of node.listChildren()) visit(c)
  }
  if (scene) for (const n of scene.listChildren()) visit(n)
  else for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) total += primitiveTriangles(p)
  return total
}

function mainScene(doc: Document): Scene | null {
  const root = doc.getRoot()
  return root.getDefaultScene() ?? root.listScenes()[0] ?? null
}

/**
 * Simplifies until the triangle count is under the budget, loosening the error bound in steps. Hard
 * normals and flat shading split vertices and stop the simplifier early; when that happens the
 * normals are dropped, the mesh re-welded and simplified again, and smooth normals rebuilt.
 */
async function simplifyToBudget(doc: Document, budget: number): Promise<boolean> {
  let tris = countTriangles(doc)
  if (tris <= budget) return false
  const passes = async (errors: number[]) => {
    for (const error of errors) {
      const ratio = Math.max(0.01, (budget / tris) * 0.95)
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }))
      tris = countTriangles(doc)
      if (tris <= budget) return
    }
  }
  await passes([0.001, 0.01, 0.05])
  if (tris > budget) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        prim.setAttribute('NORMAL', null)
        prim.setAttribute('TANGENT', null)
      }
    }
    await doc.transform(weld())
    await passes([0.01, 0.05, 0.2])
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) smoothNormals(doc, prim)
  }
  return true
}

/** Area-weighted smooth normals for an indexed triangle primitive (glTF Transform's `normals` is flat). */
function smoothNormals(doc: Document, prim: Primitive): void {
  const pos = prim.getAttribute('POSITION')
  const idx = prim.getIndices()
  if (!pos || !idx || prim.getMode() !== 4) return
  const p = pos.getArray()!
  const ix = idx.getArray()!
  const n = new Float32Array(pos.getCount() * 3)
  for (let t = 0; t + 2 < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2])
    if (l > 0) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l } else n[i + 1] = 1
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(pos.getBuffer()))
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(w: number, h: number): AnyCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

function canvasToBlob(c: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality })
  return new Promise((resolve) => (c as HTMLCanvasElement).toBlob(resolve, type, quality))
}

/**
 * Resizes every texture to at most `maxPx` and re-encodes it as WebP. Keeps the original when the
 * browser cannot decode it, cannot encode WebP (then it only shrinks oversize images in their own
 * format), or when the re-encode would be larger.
 */
async function compressTextures(doc: Document, maxPx: number, warnings: string[]): Promise<number> {
  const textures = doc.getRoot().listTextures()
  if (!textures.length) return 0
  if (typeof createImageBitmap === 'undefined' || !makeCanvas(1, 1)) {
    warnings.push('Textures were kept at their original size (no image encoder here).')
    return 0
  }
  let changed = 0
  let webp = false
  for (const tex of textures) {
    const image = tex.getImage()
    const mime = tex.getMimeType()
    if (!image || mime === 'image/ktx2') continue
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: mime }))
    } catch {
      warnings.push(`A texture (${tex.getName() || tex.getURI() || mime}) could not be decoded and was kept as is.`)
      continue
    }
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    if (scale === 1 && mime === 'image/webp') { bitmap.close(); continue }
    const canvas = makeCanvas(w, h)!
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!ctx) { bitmap.close(); continue }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    let blob = await canvasToBlob(canvas, 'image/webp', 0.88)
    if (!blob || blob.type !== 'image/webp') {
      // No WebP encoder (older Safari): only shrink oversize images, in their own format.
      if (scale === 1) continue
      blob = await canvasToBlob(canvas, mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9)
      if (!blob) continue
    }
    if (scale === 1 && blob.size >= image.byteLength) continue
    tex.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType(blob.type)
    const uri = tex.getURI()
    if (uri) tex.setURI(uri.replace(/\.[a-z0-9]+$/i, blob.type === 'image/webp' ? '.webp' : blob.type === 'image/jpeg' ? '.jpg' : '.png'))
    if (blob.type === 'image/webp') webp = true
    changed++
  }
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true)
  return changed
}

/**
 * Wraps the scene in one node that turns it Y-up, scales it to metres and puts the bottom centre
 * of its bounds at the origin. Returns the guess and the final size.
 */
function normalise(doc: Document, opts: { zUp: boolean; format: SourceFormat; category?: string; knownSize?: Vec3 }): { guess: SizeGuess; size: Vec3 } {
  const scene = mainScene(doc)
  if (!scene) throw new ModelImportError('empty', 'The model has no scene.')
  const root = doc.createNode(ROOT_NODE_NAME).setExtras({ vtt: 'normalised' })
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    root.addChild(child)
  }
  scene.addChild(root)
  doc.getRoot().setDefaultScene(scene)
  if (opts.zUp) root.setRotation(Z_UP_TO_Y_UP)
  const b = getBounds(scene)
  const min = b.min as Vec3
  const max = b.max as Vec3
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) throw new ModelImportError('empty', 'The model has no geometry.')
  const raw: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const guess = guessRealSize(raw, { format: opts.format, category: opts.category, knownSize: opts.knownSize })
  root.setScale([guess.scale, guess.scale, guess.scale])
  root.setTranslation(pivotOffset(min, max, guess.scale))
  return { guess, size: guess.size }
}

function embedLicence(doc: Document, title: string, licence: Licence): void {
  const asset = doc.getRoot().getAsset()
  asset.copyright = creditLine(title, licence)
  asset.generator = 'vttrpg model import'
  asset.extras = { ...(asset.extras as object | undefined), ...attributionExtras(title, licence) }
}

export async function optimiseModel(input: OptimiseInput, opts: OptimiseOptions): Promise<OptimiseResult> {
  const report = opts.onProgress ?? (() => {})
  const warnings: string[] = []
  const budget = TIER_BUDGETS[opts.tier]
  report(0, 'Reading the model')
  const io = await getIO()
  const doc = await readDocument(io, input)
  const sourceTriangles = countTriangles(doc)
  if (!sourceTriangles) throw new ModelImportError('empty', 'The model has no triangles to show.')

  report(0.15, 'Cleaning up')
  await doc.transform(dedup(), prune({ keepAttributes: false }), weld())

  report(0.3, 'Reducing triangles')
  const simplified = await simplifyToBudget(doc, budget.triangles)
  if (simplified && countTriangles(doc) > budget.triangles) {
    warnings.push(`Still ${countTriangles(doc).toLocaleString()} triangles after simplifying; it may be slow on phones.`)
  }

  report(0.5, 'Resizing textures')
  const texturesResized = await compressTextures(doc, budget.texturePx, warnings)

  report(0.7, 'Scaling and centring')
  const { guess, size } = normalise(doc, { zUp: opts.zUp, format: input.sourceFormat, category: opts.category, knownSize: opts.knownSize })
  embedLicence(doc, opts.title, opts.licence)

  report(0.8, 'Compressing')
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const glb = await io.writeBinary(doc)
  report(1, 'Optimised')
  return { glb, sourceTriangles, triangles: countTriangles(doc), size, sizeGuess: guess, simplified, texturesResized, warnings }
}

/**
 * Multiplies the normalisation scale by `factor` (the GM's real-size correction). The pivot stays
 * at the bottom centre because the root translation scales with it.
 */
export async function rescaleGlb(glb: Uint8Array, factor: number): Promise<Uint8Array> {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new ModelImportError('corrupt', 'The scale must be a positive number.')
  if (factor === 1) return glb
  const io = await getIO()
  const doc = await io.readBinary(glb)
  const root = doc.getRoot().listNodes().find((n) => n.getName() === ROOT_NODE_NAME)
  if (!root) throw new ModelImportError('corrupt', 'This GLB was not produced by the import pipeline.')
  root.setScale(root.getScale().map((v) => v * factor) as Vec3)
  root.setTranslation(root.getTranslation().map((v) => v * factor) as Vec3)
  return io.writeBinary(doc)
}

/** Reads `asset.extras` back from a GLB (credits list, tests). */
export async function readGlbAttribution(glb: Uint8Array): Promise<Record<string, unknown> | undefined> {
  const io = await getIO()
  const doc = await io.readBinary(glb)
  const asset = doc.getRoot().getAsset()
  return { copyright: asset.copyright, ...(asset.extras as object | undefined) }
}

/** Bounds of a GLB in metres: [x, y, z] sizes plus the min corner. */
export async function measureGlb(glb: Uint8Array): Promise<{ min: Vec3; max: Vec3; triangles: number }> {
  const io = await getIO()
  const doc = await io.readBinary(glb)
  const scene = mainScene(doc)
  if (!scene) throw new ModelImportError('empty', 'The model has no scene.')
  const b = getBounds(scene)
  return { min: b.min as Vec3, max: b.max as Vec3, triangles: countTriangles(doc) }
}
