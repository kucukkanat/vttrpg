/**
 * Wall detection for a map image scene, browser side: decode the image, draw a downscaled copy
 * (about 16 px per cell), hand the pixels to the worker and turn its result into world segments
 * for the scene. The GM reviews the proposal on the table before accepting it.
 */
import type { Scene } from '@/core/doc'
import { imageFrame, imageWallsToWorld } from '@/table/imageScene'
import type { WallSegment } from '@/table/segments'
import { detectionSize, detectWalls, lumaFromRgba, type WallDetectResult } from './wallDetect'
import type { WallDetectReply, WallDetectRequest } from './wallDetect.worker'

export interface DetectedWalls {
  /** World segments for the scene, ready for `wall.add`. */
  walls: WallSegment[]
  threshold: number
}

/** RGBA pixels of the image, downscaled to about 16 px per cell. */
async function pixels(blob: Blob, cells: number): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  try {
    const size = detectionSize(bmp.width, bmp.height, cells)
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size.width, size.height)
      : Object.assign(document.createElement('canvas'), size)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error('no 2D canvas available')
    ctx.drawImage(bmp, 0, 0, size.width, size.height)
    return { rgba: ctx.getImageData(0, 0, size.width, size.height).data, ...size }
  } finally {
    bmp.close()
  }
}

let seq = 0

/** Run detection in a worker (or inline where workers are unavailable). */
function analyse(req: Omit<WallDetectRequest, 'id'>): Promise<WallDetectResult> {
  if (typeof Worker === 'undefined') {
    const luma = lumaFromRgba(req.rgba, req.width, req.height)
    return Promise.resolve(detectWalls({ luma, width: req.width, height: req.height, widthCells: req.widthCells, heightCells: req.heightCells }, { sensitivity: req.sensitivity }))
  }
  const worker = new Worker(new URL('./wallDetect.worker.ts', import.meta.url), { type: 'module' })
  const id = ++seq
  return new Promise<WallDetectResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WallDetectReply>) => {
      if (e.data.id !== id) return
      worker.terminate()
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'wall detection failed')) }
    worker.postMessage({ ...req, id }, [req.rgba.buffer])
  })
}

const round = (v: number) => { const r = Math.round(v * 1e4) / 1e4; return r === 0 ? 0 : r }

/** Detect walls on the map image of `scene` (`blob` is that image). */
export async function detectSceneWalls(scene: Pick<Scene, 'grid' | 'image'>, blob: Blob, sensitivity = 0.5): Promise<DetectedWalls> {
  const image = scene.image
  if (!image) throw new Error('this scene has no map image')
  const px = await pixels(blob, image.widthCells)
  const result = await analyse({ ...px, widthCells: image.widthCells, heightCells: image.heightCells, sensitivity })
  const frame = imageFrame(scene.grid, image)
  const walls = imageWallsToWorld(frame, result.walls.map((w) => ({ a: { x: w.a.x, z: w.a.y }, b: { x: w.b.x, z: w.b.y } })))
    .map((w) => ({ a: { x: round(w.a.x), z: round(w.a.z) }, b: { x: round(w.b.x), z: round(w.b.z) } }))
  return { walls, threshold: result.threshold }
}
