/**
 * Plain map images (a PNG / JPEG / WebP battle map) as scenes. This is also the Owlbear Rodeo
 * path: Owlbear has no scene export format, so a map made there is saved as an image and brought
 * in here with the number of grid columns across it; walls are not available and must be added
 * on the table.
 */
import type { AssetRef } from '@/core/assets'
import type { Scene } from '@/core/doc'
import type { GridType } from '@/core/geometry'
import type { Intent } from '@/core/intents'
import { imageSceneLayout } from '@/table/imageScene'
import { buildImageScene } from './scene'

/** The slice of the game controller imports need; structural so tests can pass a stub. */
export interface ImportController {
  assets: { shareFile(file: File): Promise<AssetRef> }
  dispatch(intent: Intent): Promise<void>
}

export interface ImageSize { width: number; height: number }

/** Pixel size of an image blob. Browser only (createImageBitmap, falling back to an <img>). */
export async function readImageSize(blob: Blob): Promise<ImageSize> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close()
      return size
    } catch {
      // fall through to the <img> path (e.g. unsupported type for createImageBitmap)
    }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('cannot read image size outside a browser')
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<ImageSize>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('not a readable image'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface MapImageOptions {
  /** Grid columns across the image; rows follow from the aspect ratio. */
  columns: number
  cellSize: number
  gridType?: GridType
  name?: string
  darkness?: number
  /** Make the new scene live as well (default true); false stages it for the GM to switch to later. */
  activate?: boolean
}

/** A sensible default column count for an image: about 70 px per cell, clamped to 4..100. */
export function suggestColumns(pixelWidth: number): number {
  return Math.min(100, Math.max(4, Math.round(pixelWidth / 70)))
}

/** Import the image as an asset, lay it out `columns` cells wide and add + activate the scene. */
export async function createImageScene(file: File, controller: ImportController, opts: MapImageOptions, size?: ImageSize): Promise<Scene> {
  const px = size ?? (await readImageSize(file))
  const asset = await controller.assets.shareFile(file)
  const layout = imageSceneLayout(opts.columns, px.width, px.height, opts.cellSize)
  const scene = buildImageScene({
    name: opts.name ?? file.name.replace(/\.[^.]+$/, ''),
    asset,
    widthCells: layout.widthCells,
    heightCells: layout.heightCells,
    cellSize: opts.cellSize,
    gridType: opts.gridType,
    darkness: opts.darkness,
  })
  await controller.dispatch({ type: 'scene.add', scene })
  if (opts.activate !== false) await controller.dispatch({ type: 'scene.activate', scene: scene.id })
  return scene
}
