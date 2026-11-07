/**
 * The part of the pipeline that can run anywhere (worker or main thread): collect the files,
 * convert DOM-free formats, optimise and normalise. Formats that need image decoding through
 * three.js (OBJ with MTL, FBX, Draco glTF) are converted by the caller on the main thread first and
 * arrive here as a GLB.
 */
import { convertToGlb, convertsWithoutDom, needsThreeConversion } from './convert'
import { collectModelSet, type ModelSet } from './formats'
import { optimiseModel, type OptimiseOptions, type OptimiseResult } from './optimise'
import type { InputFile, SourceFormat } from './types'

export interface CoreRequest {
  files: InputFile[]
  /** Set when the main thread already converted the files to a GLB. */
  convertedGlb?: Uint8Array
  sourceFormat?: SourceFormat
  options: Omit<OptimiseOptions, 'onProgress'>
}

export interface CoreResult extends OptimiseResult {
  sourceFormat: SourceFormat
}

/** Whether `set` must be converted on the main thread (needs a DOM to decode textures). */
export function needsMainThreadConversion(set: ModelSet): boolean {
  return needsThreeConversion(set) && !convertsWithoutDom(set)
}

export async function runCore(req: CoreRequest, onProgress: (fraction: number, message: string) => void = () => {}): Promise<CoreResult> {
  const warnings: string[] = []
  let input: Parameters<typeof optimiseModel>[0]
  if (req.convertedGlb) {
    input = { glb: req.convertedGlb, sourceFormat: req.sourceFormat ?? 'glb' }
  } else {
    const set = await collectModelSet(req.files)
    if (needsThreeConversion(set)) {
      onProgress(0.05, `Converting ${set.format.toUpperCase()} to GLB`)
      input = { glb: await convertToGlb(set, warnings), sourceFormat: set.format }
    } else if (set.format === 'glb') {
      input = { glb: set.main.bytes, sourceFormat: 'glb' }
    } else {
      input = { gltf: { main: set.main, files: set.files }, sourceFormat: 'gltf' }
    }
  }
  const result = await optimiseModel(input, { ...req.options, onProgress: (f, m) => onProgress(0.1 + f * 0.9, m) })
  return { ...result, warnings: [...warnings, ...result.warnings], sourceFormat: input.sourceFormat }
}
