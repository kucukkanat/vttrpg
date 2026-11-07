/**
 * Orchestrates a map import: detect the format, parse, get the image (embedded, or asked from the
 * user for Foundry exports), import it as an asset, build the scene and add + activate it.
 */
import type { Prop, Scene } from '@/core/doc'
import type { GridType } from '@/core/geometry'
import { isFoundryScene, parseFoundryScene } from './foundry'
import type { ImportController } from './mapImage'
import { imageWallProps, sceneFromParsedMap } from './scene'
import { MAX_PROPS_PER_INTENT } from '@/core/props'
import type { ParsedMap } from './types'
import { isUvtt, parseUvtt } from './uvtt'

export type MapFormat = ParsedMap['format']

export interface ImportHooks {
  /** World units per cell for the new scene (the pack's grid cell size). */
  cellSize: number
  gridType?: GridType
  /**
   * The export references an image that cannot be fetched (Foundry), or embeds none: ask the user
   * for the file. Resolve null to cancel the import. Without this hook such imports fail.
   */
  pickImage?(info: { name: string; imagePath?: string; pixelSize?: { width: number; height: number }; format: MapFormat }): Promise<File | null>
  /** Foundry only: pixels per cell when the file does not declare a grid size. */
  gridSize?: number
  darkness?: number
  /** Make the new scene live as well (default true); false stages it for the GM to switch to later. */
  activate?: boolean
}

export interface ImportResult {
  scene: Scene
  /** The map's walls and doors, placed as invisible wall and door props. */
  props: Prop[]
  parsed: ParsedMap
  /** What was skipped or approximated, for the GM. */
  notes: string[]
}

export const IMPORT_EXTENSIONS = ['.dd2vtt', '.uvtt', '.json'] as const

/** Which parser handles the file, from its name and (for .json) its content. */
export function detectMapFormat(name: string, json: unknown): MapFormat | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.dd2vtt') || lower.endsWith('.uvtt')) return 'uvtt'
  if (isUvtt(json)) return 'uvtt'
  if (isFoundryScene(json)) return 'foundry'
  return null
}

/** Parse any supported map export into the neutral form. */
export function parseMapJson(name: string, json: unknown, opts: { gridSize?: number } = {}): ParsedMap {
  const format = detectMapFormat(name, json)
  if (format === 'uvtt') return parseUvtt(json, { name: name.replace(/\.(dd2vtt|uvtt|json)$/i, '') })
  if (format === 'foundry') return parseFoundryScene(json, opts.gridSize)
  throw new Error(`${name}: not a Universal VTT (.dd2vtt / .uvtt) or Foundry scene export`)
}

export async function parseMapFile(file: File, opts: { gridSize?: number } = {}): Promise<ParsedMap> {
  const text = await file.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${file.name}: not valid JSON`)
  }
  return parseMapJson(file.name, json, opts)
}

/**
 * Import a map export as a new, active scene. Returns null when the user cancelled the image
 * prompt. Throws with a readable message on anything else.
 */
export async function importSceneFile(file: File, controller: ImportController, hooks: ImportHooks): Promise<ImportResult | null> {
  const parsed = await parseMapFile(file, { gridSize: hooks.gridSize })
  const notes = [...parsed.notes]
  let imageFile: File | null = null
  if (parsed.image) {
    const bytes = parsed.image.bytes
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    imageFile = new File([copy], parsed.image.name, { type: parsed.image.mime })
  } else {
    if (!hooks.pickImage) throw new Error(`${file.name}: the map image is not embedded; it has to be chosen separately`)
    imageFile = await hooks.pickImage({ name: parsed.name ?? file.name, imagePath: parsed.imagePath, pixelSize: parsed.pixelSize, format: parsed.format })
    if (!imageFile) return null
  }
  const asset = await controller.assets.shareFile(imageFile)
  const scene = sceneFromParsedMap(parsed, asset, { cellSize: hooks.cellSize, gridType: hooks.gridType, darkness: hooks.darkness })
  await controller.dispatch({ type: 'scene.add', scene })
  // Walls and doors arrive as invisible wall and door props, batched (one intent per 5000).
  const props = imageWallProps(scene, parsed.walls)
  for (let i = 0; i < props.length; i += MAX_PROPS_PER_INTENT) await controller.dispatch({ type: 'props.place', props: props.slice(i, i + MAX_PROPS_PER_INTENT) })
  if (hooks.activate !== false) await controller.dispatch({ type: 'scene.activate', scene: scene.id })
  return { scene, props, parsed, notes }
}
