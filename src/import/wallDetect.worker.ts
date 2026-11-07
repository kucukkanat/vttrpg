/**
 * Worker side of wall detection: RGBA pixels in, wall segments in map grid units out, so a large
 * map never blocks the table. See wallDetect.ts for the method.
 */
import { detectWalls, lumaFromRgba, type WallDetectResult } from './wallDetect'

export interface WallDetectRequest {
  id: number
  rgba: Uint8ClampedArray
  width: number
  height: number
  widthCells: number
  heightCells: number
  sensitivity: number
}

export type WallDetectReply = { id: number; ok: true; result: WallDetectResult } | { id: number; ok: false; error: string }

// Typed loosely so the file also compiles under the app's DOM lib.
const scope = self as unknown as { onmessage: ((e: MessageEvent<WallDetectRequest>) => void) | null; postMessage(m: WallDetectReply): void }

scope.onmessage = (e) => {
  const r = e.data
  try {
    const luma = lumaFromRgba(r.rgba, r.width, r.height)
    const result = detectWalls({ luma, width: r.width, height: r.height, widthCells: r.widthCells, heightCells: r.heightCells }, { sensitivity: r.sensitivity })
    scope.postMessage({ id: r.id, ok: true, result })
  } catch (err) {
    scope.postMessage({ id: r.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
