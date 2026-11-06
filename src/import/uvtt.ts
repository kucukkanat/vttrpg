/**
 * Universal VTT (`.dd2vtt` from Dungeondraft, `.uvtt` from Dungeon Alchemist, Arkenforge and
 * others). One JSON object:
 *
 *   resolution: { map_origin: {x,y}, map_size: {x,y}, pixels_per_grid }  -- all in grid units / px
 *   line_of_sight: [[{x,y}, ...], ...]       polylines in grid units from the map origin
 *   objects_line_of_sight: [[...], ...]      same, for furniture (format 0.3+)
 *   portals: [{ position, bounds: [{x,y},{x,y}], rotation, closed, freestanding }]
 *   lights: [{ position, range, intensity, color, shadows }]
 *   image: base64 PNG / JPEG / WebP
 *
 * Closed portals block sight like walls; open ones are gaps. Lights are ignored for now
 * (the table's lights come from tokens), noted in `notes`.
 */
import type { MapImage, MapPoint, MapWall, ParsedMap } from './types'

interface UvttJson {
  format?: number
  resolution?: { map_origin?: MapPoint; map_size?: MapPoint; pixels_per_grid?: number }
  line_of_sight?: MapPoint[][]
  objects_line_of_sight?: MapPoint[][]
  portals?: { position?: MapPoint; bounds?: MapPoint[]; rotation?: number; closed?: boolean; freestanding?: boolean }[]
  lights?: unknown[]
  image?: string
}

const isPoint = (p: unknown): p is MapPoint =>
  typeof p === 'object' && p !== null && typeof (p as MapPoint).x === 'number' && typeof (p as MapPoint).y === 'number'
  && Number.isFinite((p as MapPoint).x) && Number.isFinite((p as MapPoint).y)

/** True when the object looks like a Universal VTT export. */
export function isUvtt(json: unknown): json is UvttJson {
  if (typeof json !== 'object' || json === null) return false
  const j = json as UvttJson
  return !!j.resolution && isPoint(j.resolution.map_size) && (Array.isArray(j.line_of_sight) || typeof j.image === 'string')
}

/**
 * Parse a Universal VTT document (already JSON-parsed, or the raw text). Walls come out in grid
 * units relative to the image's top-left corner; the image is decoded from base64.
 */
export function parseUvtt(input: unknown, opts: { name?: string } = {}): ParsedMap {
  const json: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!isUvtt(json)) throw new Error('Not a Universal VTT file: expected resolution.map_size and line_of_sight')
  const res = json.resolution!
  const size = res.map_size!
  if (!(size.x > 0) || !(size.y > 0)) throw new Error('Universal VTT: map_size must be positive')
  const origin = isPoint(res.map_origin) ? res.map_origin : { x: 0, y: 0 }
  const notes: string[] = []
  const walls: MapWall[] = []
  const shift = (p: MapPoint): MapPoint => ({ x: p.x - origin.x, y: p.y - origin.y })

  const polylines = (lines: unknown, label: string) => {
    if (lines === undefined) return
    if (!Array.isArray(lines)) { notes.push(`${label}: not a list, ignored`); return }
    for (const line of lines) {
      if (!Array.isArray(line)) continue
      const pts = line.filter(isPoint).map(shift)
      for (let i = 1; i < pts.length; i++) pushWall(walls, pts[i - 1]!, pts[i]!)
    }
  }
  polylines(json.line_of_sight, 'line_of_sight')
  polylines(json.objects_line_of_sight, 'objects_line_of_sight')

  let openPortals = 0
  for (const p of json.portals ?? []) {
    const b = p?.bounds
    if (!Array.isArray(b) || b.length < 2 || !isPoint(b[0]) || !isPoint(b[1])) continue
    if (p.closed === false) { openPortals++; continue }
    pushWall(walls, shift(b[0]), shift(b[1]))
  }
  if (openPortals) notes.push(`${openPortals} open portal${openPortals === 1 ? '' : 's'} left as gaps`)
  const lights = Array.isArray(json.lights) ? json.lights.length : 0
  if (lights) notes.push(`${lights} map light${lights === 1 ? '' : 's'} ignored (use token lights)`)

  const ppg = typeof res.pixels_per_grid === 'number' && res.pixels_per_grid > 0 ? res.pixels_per_grid : undefined
  const image = typeof json.image === 'string' && json.image.length > 0 ? decodeImage(json.image, opts.name ?? 'map') : undefined
  if (!image) notes.push('no embedded image')
  return {
    format: 'uvtt',
    name: opts.name,
    widthCells: size.x,
    heightCells: size.y,
    pixelsPerCell: ppg,
    pixelSize: ppg ? { width: size.x * ppg, height: size.y * ppg } : undefined,
    walls,
    image,
    notes,
  }
}

function pushWall(out: MapWall[], a: MapPoint, b: MapPoint) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return
  out.push({ a, b })
}

/** Decode the base64 image and sniff its type from the magic bytes. */
export function decodeImage(base64: string, baseName: string): MapImage {
  const clean = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const { mime, ext } = sniffImage(bytes)
  return { bytes, mime, name: `${baseName.replace(/\.(dd2vtt|uvtt|json)$/i, '')}.${ext}` }
}

export function sniffImage(b: Uint8Array): { mime: string; ext: string } {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'image/png', ext: 'png' }
}
