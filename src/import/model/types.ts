/**
 * Shared types for the in-browser model import pipeline (reports/Level design plan.md, Phase 3).
 * Kept free of three.js and glTF Transform so the dialog and the API clients can import them
 * without pulling the heavy pipeline into their chunk.
 */
import type { CatalogueEntry, CatalogueOrigin, Licence } from '@/core/catalogue'

/** Largest upload we accept, summed over every file of one model. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024

/** Device tier the optimiser targets. */
export type ImportTier = 'desktop' | 'phone'

export const TIER_BUDGETS: Record<ImportTier, { triangles: number; texturePx: number }> = {
  desktop: { triangles: 50_000, texturePx: 2048 },
  phone: { triangles: 15_000, texturePx: 1024 },
}

export type SourceFormat = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'zip'

export type ImportStage = 'read' | 'convert' | 'optimise' | 'normalise' | 'thumbnail' | 'download' | 'store'

export interface ImportProgress {
  stage: ImportStage
  /** Overall progress, 0 to 1. */
  progress: number
  message: string
}

export type ProgressCallback = (p: ImportProgress) => void

export type ImportErrorCode =
  | 'too-large'
  | 'unsupported'
  | 'corrupt'
  | 'missing-file'
  | 'empty'
  | 'licence'
  | 'network'
  | 'auth'
  | 'cancelled'

/** Every failure the pipeline reports to the UI. `message` is a sentence meant for the GM. */
export class ModelImportError extends Error {
  readonly code: ImportErrorCode
  constructor(code: ImportErrorCode, message: string) {
    super(message)
    this.name = 'ModelImportError'
    this.code = code
  }
}

export function isModelImportError(e: unknown): e is ModelImportError {
  return e instanceof Error && e.name === 'ModelImportError' && typeof (e as ModelImportError).code === 'string'
}

/** One file handed to the pipeline: the main model plus any companions (.bin, .mtl, textures). */
export interface InputFile {
  name: string
  bytes: Uint8Array
}

/** How the real-size guess was made, for the confirm step. */
export type SizeReason = 'source' | 'known' | 'centimetres' | 'millimetres' | 'inches' | 'miniature' | 'category'

export interface SizeGuess {
  /** Uniform factor applied to the source units. */
  scale: number
  /** Bounds in metres after scaling: [x, y, z]. */
  size: [number, number, number]
  reason: SizeReason
  /** A sentence for the confirm step ("Looks like centimetres; scaled to 1.80 m tall"). */
  note: string
}

/** The catalogue fields the pipeline can fill; the caller adds `model` and `thumbnail` after storing. */
export type CatalogueDraft = Omit<CatalogueEntry, 'model' | 'thumbnail'> & Partial<Pick<CatalogueEntry, 'model' | 'thumbnail'>>

export interface ImportMeta {
  origin: CatalogueOrigin
  /** Provider id (Poly Haven asset id, Sketchfab uid); uploads use the GLB hash. */
  sourceId?: string
  title: string
  category?: string
  tags?: string[]
  theme?: string
  licence: Licence
  /** True size in metres when the provider knows it (Poly Haven `dimensions`). */
  knownSize?: [number, number, number]
}

export interface PrepareOptions {
  tier?: ImportTier
  /** Source is Z-up (STL and some OBJ): rotate it to Y-up. Defaults to true for STL. */
  zUp?: boolean
  onProgress?: ProgressCallback
  signal?: AbortSignal
  /** Run the heavy steps on a worker when the browser allows it. Default true. */
  useWorker?: boolean
  /** Render the thumbnail; injected in tests (no WebGL in Node). */
  renderThumbnail?: (glb: Uint8Array) => Promise<Blob>
}

/** The pipeline's result before the real-size confirm and storage. */
export interface PreparedModel {
  glb: Uint8Array
  thumbnail: Blob
  entry: CatalogueDraft
  sizeGuess: SizeGuess
  /** Statistics for the UI. */
  stats: {
    sourceBytes: number
    sourceTriangles: number
    triangles: number
    bytes: number
    simplified: boolean
    texturesResized: number
    warnings: string[]
  }
}
