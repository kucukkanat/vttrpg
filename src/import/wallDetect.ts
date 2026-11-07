/**
 * Automatic wall detection on a battle map image. Pure: luminance in, wall segments in map grid
 * units out (x right, y down from the image's top-left corner, the convention of `MapWall`), so
 * `imageWallsToWorld` puts them on the table. Runs in a worker (wallDetect.worker.ts) on a
 * downscaled copy of the image; the GM reviews the result before any wall is created.
 *
 * Battle maps draw walls in two ways, and both are looked for along the grid's cell edges:
 * - solid areas (the black outside of a dungeon, thick stone): a cell that is mostly dark is solid,
 *   and every edge between a solid cell and an open one is a wall;
 * - dark lines between two open cells: an edge whose thin strip is dark along most of its length.
 * Dark means darker than a threshold found by Otsu's method, scaled by the sensitivity; a map
 * without enough contrast has no dark pixels at all. Unit edges
 * that touch along a row or column are joined into one segment.
 */
import type { MapWall } from './types'

export interface WallDetectInput {
  /** One luminance byte (0 black … 255 white) per pixel, row-major. */
  luma: Uint8Array
  width: number
  height: number
  /** Map size in cells; the image spans exactly this many (rows may be fractional). */
  widthCells: number
  heightCells: number
}

export interface WallDetectOptions {
  /** 0..1: higher finds fainter walls (a lighter threshold, less coverage needed). Default 0.5. */
  sensitivity?: number
}

export interface WallDetectResult {
  walls: MapWall[]
  /** The darkness threshold used (0..255). */
  threshold: number
  /** Cells classed as solid. */
  solidCells: number
}

/** Rec. 601 luma of RGBA pixels (alpha is ignored; transparent pixels count as their colour). */
export function lumaFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (rgba[j]! * 299 + rgba[j + 1]! * 587 + rgba[j + 2]! * 114) / 1000
  }
  return out
}

/**
 * Otsu's split of a luminance histogram: the dark and light class means of the split that best
 * separates them. `threshold` is halfway between the two means (the plain Otsu cut can sit
 * anywhere on an empty stretch of the histogram, e.g. right on top of a black class).
 */
export function otsuSplit(luma: Uint8Array): { threshold: number; dark: number; light: number } {
  const hist = new Float64Array(256)
  for (let i = 0; i < luma.length; i++) hist[luma[i]!]!++
  const total = luma.length
  if (!total) return { threshold: 128, dark: 128, light: 128 }
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]!
  let sumB = 0, wB = 0, best = -1
  let out = { threshold: 128, dark: 128, light: 128 }
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; out = { threshold: (mB + mF) / 2, dark: mB, light: mF } }
  }
  if (best < 0) {
    const m = sum / total
    return { threshold: m, dark: m, light: m }
  }
  return out
}

/** Otsu's threshold (see `otsuSplit`), rounded. */
export function otsuThreshold(luma: Uint8Array): number {
  return Math.round(otsuSplit(luma).threshold)
}

/** Below this difference between the dark and light classes the map has no walls to find. */
const MIN_CONTRAST = 48

export function detectWalls(input: WallDetectInput, opts: WallDetectOptions = {}): WallDetectResult {
  const { luma, width, height } = input
  const cols = Math.max(1, Math.round(input.widthCells))
  const rows = Math.max(1, Math.ceil(input.heightCells - 1e-6))
  const ppc = width / Math.max(1e-6, input.widthCells)
  const sens = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5))
  // Sensitivity moves the threshold from 70% to 130% of Otsu's and the coverage from 80% to 45%.
  const split = otsuSplit(luma)
  // A flat image (one floor colour and its texture) splits its own noise in two: nothing is dark.
  const threshold = split.light - split.dark < MIN_CONTRAST ? 0 : Math.min(250, Math.max(5, Math.round(split.threshold * (0.7 + 0.6 * sens))))
  const lineCoverage = 0.8 - 0.35 * sens
  const solidFraction = 0.6
  const dark = (x: number, y: number) => luma[y * width + x]! < threshold

  const px = (c: number) => Math.min(width, Math.max(0, Math.round(c * ppc)))
  const py = (r: number) => Math.min(height, Math.max(0, Math.round(r * ppc)))

  // 1. Solid cells: mostly dark inside (an inset of the cell, so lines on its edges do not count).
  const solid = new Uint8Array(cols * rows)
  let solidCells = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inset = ppc * 0.2
      const x0 = Math.floor(px(c) + inset), x1 = Math.ceil(px(c + 1) - inset)
      const y0 = Math.floor(py(r) + inset), y1 = Math.ceil(py(r + 1) - inset)
      let n = 0, d = 0
      const step = Math.max(1, Math.floor((x1 - x0) / 8))
      for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { n++; if (dark(x, y)) d++ }
      if (n && d / n >= solidFraction) { solid[r * cols + c] = 1; solidCells++ }
    }
  }
  const isSolid = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && solid[r * cols + c] === 1

  // 2. A dark line along an edge: sample along it, a sample counts when any pixel across the thin strip is dark.
  const half = Math.max(1, Math.round(ppc * 0.08))
  const lineAlong = (vertical: boolean, at: number, from: number, to: number): boolean => {
    const a = Math.round(from + (to - from) * 0.15), b = Math.round(to - (to - from) * 0.15)
    if (b <= a) return false
    let n = 0, hit = 0
    const step = Math.max(1, Math.floor((b - a) / 12))
    for (let t = a; t < b; t += step) {
      n++
      for (let o = -half; o <= half; o++) {
        const x = vertical ? at + o : t
        const y = vertical ? t : at + o
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if (dark(x, y)) { hit++; break }
      }
    }
    return n > 0 && hit / n >= lineCoverage
  }

  // Unit edges: horizontal ones on grid row lines y = r (between rows r-1 and r), vertical on x = c.
  const hEdge = new Uint8Array(cols * (rows + 1))
  const vEdge = new Uint8Array((cols + 1) * rows)
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const above = isSolid(c, r - 1), below = isSolid(c, r)
      if (above !== below) hEdge[r * cols + c] = 1
      else if (!above && lineAlong(false, py(r), px(c), px(c + 1))) hEdge[r * cols + c] = 1
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const left = isSolid(c - 1, r), right = isSolid(c, r)
      if (left !== right) vEdge[r * (cols + 1) + c] = 1
      else if (!left && lineAlong(true, px(c), py(r), py(r + 1))) vEdge[r * (cols + 1) + c] = 1
    }
  }

  // 3. Join runs of unit edges into segments.
  const walls: MapWall[] = []
  for (let r = 1; r < rows; r++) {
    let start = -1
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && hEdge[r * cols + c] === 1
      if (on && start < 0) start = c
      if (!on && start >= 0) { walls.push({ a: { x: start, y: r }, b: { x: c, y: r } }); start = -1 }
    }
  }
  for (let c = 1; c < cols; c++) {
    let start = -1
    for (let r = 0; r <= rows; r++) {
      const on = r < rows && vEdge[r * (cols + 1) + c] === 1
      if (on && start < 0) start = r
      if (!on && start >= 0) { walls.push({ a: { x: c, y: start }, b: { x: c, y: Math.min(r, input.heightCells) } }); start = -1 }
    }
  }
  return { walls, threshold, solidCells }
}

/** Downscaled size for detection: about `ppc` pixels per cell, never larger than the image. */
export function detectionSize(width: number, height: number, widthCells: number, ppc = 16): { width: number; height: number } {
  const target = Math.max(1, Math.round(widthCells * ppc))
  const k = Math.min(1, target / Math.max(1, width))
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}
