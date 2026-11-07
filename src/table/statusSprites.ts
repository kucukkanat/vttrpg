/**
 * Canvas textures for the status chips around a token and the HP backup glyph, drawn from the same
 * path data as the DOM icons (src/ui/theme/glyphs.ts): the category frame filled dark and stroked
 * in the category colour, a monochrome glyph (or the letters), and a turns-left badge; and the
 * bloodied / down badge. One material
 * per look, cached; the pack's condition list and small turn counts bound the cache.
 */
import { CanvasTexture, SpriteMaterial, SRGBColorSpace } from 'three'
import { ICON_STROKE } from '@/ui/icons'
import { drawGlyph, GLYPH_INSET, SHAPES } from '@/ui/theme/glyphs'
import { HP_LOW, INK, PARCHMENT, STATUS_FILL, STATUS_GLYPH } from '@/ui/theme/palette'
import type { ConditionChip, VitalState } from './tokenHud'

const SIZE = 128
const chipCache = new Map<string, SpriteMaterial>()

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  return [c, c.getContext('2d')!]
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Sprite material for one status chip on the table. */
export function statusChipMaterial(chip: ConditionChip): SpriteMaterial {
  const key = `${chip.shape}|${chip.color}|${chip.glyph ?? chip.label}|${chip.remaining ?? ''}`
  const hit = chipCache.get(key)
  if (hit) return hit
  const [c, ctx] = canvas()
  // Frame on the 24 grid, inset so the stroke and the badge stay inside the canvas.
  const frame = SIZE * 0.82
  const o = (SIZE - frame) / 2
  ctx.save()
  ctx.translate(o, o)
  ctx.scale(frame / 24, frame / 24)
  if (typeof Path2D !== 'undefined') {
    const p = new Path2D(SHAPES[chip.shape])
    ctx.fillStyle = STATUS_FILL
    ctx.fill(p)
    ctx.strokeStyle = chip.color
    ctx.lineWidth = 2.6
    ctx.lineJoin = 'round'
    ctx.stroke(p)
  }
  ctx.restore()
  const g = frame * GLYPH_INSET
  const drawn = chip.glyph !== null && drawGlyph(ctx, chip.glyph, (SIZE - g) / 2, (SIZE - g) / 2, g, STATUS_GLYPH, ICON_STROKE / GLYPH_INSET)
  if (!drawn) {
    ctx.fillStyle = STATUS_GLYPH
    ctx.font = `800 ${chip.label.length > 1 ? 40 : 50}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(chip.label, SIZE / 2, SIZE / 2 + 3)
  }
  if (chip.remaining !== null) {
    const r = SIZE * 0.2
    const cx = SIZE - r - 1
    const cy = SIZE - r - 1
    ctx.fillStyle = PARCHMENT
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = STATUS_FILL
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.font = `800 ${chip.remaining > 9 ? 26 : 32}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(chip.remaining), cx, cy + 2)
  }
  const m = new SpriteMaterial({ map: texture(c), transparent: true, depthWrite: false, toneMapped: false })
  chipCache.set(key, m)
  return m
}

const vitalCache = new Map<VitalState, SpriteMaterial>()

/**
 * Camera-facing badge for a vital state (CombatBadges.tsx): a blood drop when bloodied, a skull
 * when down, drawn from the same glyphs as the token bar and the tracker.
 */
export function vitalMaterial(state: VitalState): SpriteMaterial {
  const hit = vitalCache.get(state)
  if (hit) return hit
  const [c, ctx] = canvas()
  ctx.fillStyle = STATUS_FILL
  ctx.globalAlpha = 0.85
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  const g = SIZE * 0.7
  drawGlyph(ctx, state === 'dead' ? 'skull' : 'bloodied', (SIZE - g) / 2, (SIZE - g) / 2, g, state === 'dead' ? PARCHMENT : HP_LOW, ICON_STROKE / 0.7)
  const m = new SpriteMaterial({ map: texture(c), transparent: true, depthWrite: false, toneMapped: false })
  vitalCache.set(state, m)
  return m
}
