/**
 * Format-neutral result of parsing a map export. Everything is in map grid units measured from
 * the image's top-left corner (x right, y down); `buildImageScene` turns it into a Scene.
 */
export interface MapPoint { x: number; y: number }

/** A line-of-sight blocker between two map points, in grid units; with `door`, a door there. */
export interface MapWall { a: MapPoint; b: MapPoint; door?: { open: boolean; locked?: boolean } }

export interface MapImage {
  /** Encoded image bytes (PNG, JPEG or WebP). */
  bytes: Uint8Array
  mime: string
  /** Suggested file name for the asset. */
  name: string
}

export interface ParsedMap {
  /** Source format, for messages. */
  format: 'uvtt' | 'foundry'
  name?: string
  widthCells: number
  heightCells: number
  /** Pixels per grid cell in the source image, when the format states it. */
  pixelsPerCell?: number
  /** Source image size in pixels, when the format states it. */
  pixelSize?: { width: number; height: number }
  walls: MapWall[]
  /** Embedded image (Universal VTT). Foundry exports only reference a path, see `imagePath`. */
  image?: MapImage
  /** Path the source referenced for its background; it cannot be fetched, the user supplies the file. */
  imagePath?: string
  /** 0..1 from the source, when stated (Foundry `darkness`). */
  darkness?: number
  /** Anything skipped, for the import report. */
  notes: string[]
}
