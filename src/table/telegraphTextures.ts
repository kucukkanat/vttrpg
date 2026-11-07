/**
 * Canvas textures for the telegraph language (telegraph.ts): the fill patterns tiled across a
 * template (white on transparent, tinted by the material colour), the centre badge ("!" / "+") and
 * the friendly-fire warning triangle shown over an ally inside a harmful template. Created once.
 */
import { CanvasTexture, RepeatWrapping, SpriteMaterial, SRGBColorSpace } from 'three'
import { HELP, HOSTILE, INK, PARCHMENT } from '@/ui/theme/palette'
import type { FillPattern } from './telegraph'

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return [c, c.getContext('2d')!]
}

const patterns = new Map<FillPattern, CanvasTexture>()

/**
 * Tileable fill: a faint wash everywhere plus the pattern at full alpha, so `opacity` on the
 * material sets the overall strength. Repeat it every `tile` world units (ShapeGeometry UVs are
 * in world units).
 */
export function patternTexture(kind: FillPattern): CanvasTexture {
  const hit = patterns.get(kind)
  if (hit) return hit
  const size = 64
  const [c, ctx] = canvas(size)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  if (kind === 'hatch') {
    // Diagonal stripes that meet across tile edges.
    ctx.lineWidth = 10
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath()
      ctx.moveTo(k * size - 4, size + 4)
      ctx.lineTo(k * size + size + 4, -4)
      ctx.stroke()
    }
  } else if (kind === 'plus') {
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    const m = size / 2
    ctx.beginPath()
    ctx.moveTo(m - 12, m); ctx.lineTo(m + 12, m)
    ctx.moveTo(m, m - 12); ctx.lineTo(m, m + 12)
    ctx.stroke()
  } else {
    ctx.fillRect(0, 0, size, size)
  }
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  patterns.set(kind, t)
  return t
}

let badges: Record<'!' | '+', SpriteMaterial> | null = null

/** Centre badge of a template: "!" on red-orange for hostile, "+" on green for help. */
export function badgeMaterial(badge: '!' | '+'): SpriteMaterial {
  badges ??= { '!': makeBadge('!', HOSTILE), '+': makeBadge('+', HELP) }
  return badges[badge]
}

function makeBadge(text: '!' | '+', color: string): SpriteMaterial {
  const size = 96
  const [c, ctx] = canvas(size)
  ctx.fillStyle = color
  if (text === '!') {
    // A diamond for "!", a circle for "+": the badge shape differs as well as its colour.
    ctx.beginPath()
    ctx.moveTo(size / 2, 3); ctx.lineTo(size - 3, size / 2); ctx.lineTo(size / 2, size - 3); ctx.lineTo(3, size / 2)
    ctx.closePath()
  } else {
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = INK
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.font = '900 58px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2 + 4)
  const map = new CanvasTexture(c)
  map.colorSpace = SRGBColorSpace
  return new SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })
}

let warning: SpriteMaterial | null = null

/** Friendly fire: a parchment warning triangle with a red-orange edge, over the ally's head. */
export function friendlyFireMaterial(): SpriteMaterial {
  if (warning) return warning
  const size = 96
  const [c, ctx] = canvas(size)
  ctx.beginPath()
  ctx.moveTo(size / 2, 6); ctx.lineTo(size - 4, size - 8); ctx.lineTo(4, size - 8)
  ctx.closePath()
  ctx.fillStyle = PARCHMENT
  ctx.fill()
  ctx.lineWidth = 7
  ctx.lineJoin = 'round'
  ctx.strokeStyle = HOSTILE
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.font = '900 52px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', size / 2, size * 0.62)
  const map = new CanvasTexture(c)
  map.colorSpace = SRGBColorSpace
  warning = new SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })
  return warning
}
