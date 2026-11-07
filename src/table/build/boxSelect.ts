/**
 * Box select in Build: which props a screen rectangle catches. Each prop is reduced to the
 * screen rectangle of its projected bounds; it is caught when at least half of that rectangle
 * lies inside the box, or when the box contains its projected centre. Pure.
 */
import type { PropId } from '@/core/ids'

export interface ScreenRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Pointer movement (px) before a press on empty board becomes a box. */
export const BOX_THRESHOLD_PX = 6

/** The rectangle spanned by two corners, in any order. */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): ScreenRect {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }
}

/** The screen rectangle around projected points, or null when none are in front of the camera. */
export function rectAround(points: readonly { x: number; y: number }[]): ScreenRect | null {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

const area = (r: ScreenRect) => Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxY - r.minY)

export function boxCatches(box: ScreenRect, item: ScreenRect): boolean {
  const cx = (item.minX + item.maxX) / 2
  const cy = (item.minY + item.maxY) / 2
  if (cx >= box.minX && cx <= box.maxX && cy >= box.minY && cy <= box.maxY) return true
  const overlap: ScreenRect = {
    minX: Math.max(box.minX, item.minX), minY: Math.max(box.minY, item.minY),
    maxX: Math.min(box.maxX, item.maxX), maxY: Math.min(box.maxY, item.maxY),
  }
  const a = area(item)
  return a > 0 && area(overlap) >= a / 2
}

/** The ids of the items `box` catches, in the order given. */
export function boxHits(box: ScreenRect, items: readonly { id: PropId; rect: ScreenRect }[]): PropId[] {
  return items.filter((it) => boxCatches(box, it.rect)).map((it) => it.id)
}
