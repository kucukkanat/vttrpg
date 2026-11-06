/**
 * Canvas texture atlas per die type: one tile per face, numbers drawn upright in the
 * face's `up` direction, face outline for crisp edges. One material per (type, colours),
 * shared by every die of that type, so a roll costs one draw call per die.
 */
import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { atlasGrid, dieDef, faceLabel, faceTilePolygon, type DieType } from './geometry'

export interface DieColors {
  /** Body (face) colour, any CSS colour. */
  body: string
  /** Number colour. */
  text: string
  /** Edge line colour; defaults to a darker body. */
  edge?: string
}

/** Per-type colours; `default` fills the gaps. */
export type DiceColorScheme = Partial<Record<DieType | 'default', DieColors>>

/** Light, high-contrast defaults: pastel bodies, near-black numbers. */
export const DEFAULT_SCHEME: Required<Pick<DiceColorScheme, 'default'>> & DiceColorScheme = {
  default: { body: '#f4efe6', text: '#1a1714' },
  d4: { body: '#f7d9a8', text: '#1a1714' },
  d6: { body: '#f4efe6', text: '#1a1714' },
  d8: { body: '#cfe8d5', text: '#1a1714' },
  d10: { body: '#cfe0f5', text: '#1a1714' },
  d100: { body: '#e9d5f5', text: '#1a1714' },
  d12: { body: '#f5cfd2', text: '#1a1714' },
  d20: { body: '#fbe7a1', text: '#1a1714' },
}

export const IVORY_SCHEME: DiceColorScheme = { default: { body: '#f4efe6', text: '#1a1714' } }
export const OBSIDIAN_SCHEME: DiceColorScheme = { default: { body: '#2a2a31', text: '#f7f3ea', edge: '#55555f' } }

export function colorsFor(scheme: DiceColorScheme | undefined, type: DieType): DieColors {
  return scheme?.[type] ?? scheme?.default ?? DEFAULT_SCHEME[type] ?? DEFAULT_SCHEME.default
}

const TILE = 256

function darken(css: string): string {
  // Cheap darkening through a canvas parse so any CSS colour works.
  const c = document.createElement('canvas').getContext('2d')!
  c.fillStyle = css
  const hex = c.fillStyle as string // normalised to #rrggbb
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.round(v * 0.55)).toString(16).padStart(2, '0')
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`
}

export function drawAtlas(type: DieType, colors: DieColors): HTMLCanvasElement {
  const def = dieDef(type)
  const { cols, rows } = atlasGrid(def.faces.length)
  const canvas = document.createElement('canvas')
  canvas.width = cols * TILE
  canvas.height = rows * TILE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = colors.body
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const edge = colors.edge ?? darken(colors.body)

  for (const face of def.faces) {
    const col = face.tile % cols, row = Math.floor(face.tile / cols)
    const cx = (col + 0.5) * TILE, cy = (row + 0.5) * TILE
    const poly = faceTilePolygon(def, face)
    const px = (p: { x: number; y: number }) => [cx + p.x * TILE, cy - p.y * TILE] as const

    // face outline
    ctx.beginPath()
    poly.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.closePath()
    ctx.lineWidth = TILE * 0.03
    ctx.lineJoin = 'round'
    ctx.strokeStyle = edge
    ctx.stroke()

    // inradius of the polygon in pixels: distance from centre to the nearest edge
    let inr = Infinity
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const ex = b.x - a.x, ey = b.y - a.y
      const len = Math.hypot(ex, ey)
      inr = Math.min(inr, Math.abs(ex * a.y - ey * a.x) / len)
    }
    inr *= TILE

    ctx.fillStyle = colors.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (def.vertexReadings) {
      // d4: one number near each corner, upright toward that corner
      face.vertices.forEach((vid, k) => {
        const corner = poly[k]
        const label = faceLabel(type, def.readings[vid].value)
        const [x, y] = px({ x: corner.x * 0.58, y: corner.y * 0.58 })
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.atan2(corner.x, corner.y))
        ctx.font = `bold ${Math.round(inr * 0.9)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
        ctx.fillText(label, 0, 0)
        ctx.restore()
      })
      continue
    }

    const reading = def.readings[face.tile]
    const label = faceLabel(type, reading.value)
    const size = inr * (label.length > 1 ? 1.2 : 1.6) * (poly.length === 3 ? 0.95 : 1)
    ctx.font = `bold ${Math.round(size)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
    ctx.fillText(label, cx, cy + size * 0.04)
    if (label === '6' || label === '9') {
      ctx.fillRect(cx - size * 0.2, cy + size * 0.5, size * 0.4, Math.max(3, size * 0.07))
    }
  }
  return canvas
}

const materials = new Map<string, MeshStandardMaterial>()

/** Shared material for a die type and colour set. Cached for the page lifetime (a few MB total). */
export function dieMaterial(type: DieType, colors: DieColors): MeshStandardMaterial {
  const k = `${type}|${colors.body}|${colors.text}|${colors.edge ?? ''}`
  let m = materials.get(k)
  if (m) return m
  const tex = new CanvasTexture(drawAtlas(type, colors))
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  m = new MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0 })
  materials.set(k, m)
  return m
}
