/**
 * Small camera-facing badges on a token's footprint, next to the HP bar: the bloodied / down
 * glyph (`vitalState`) and the pack's defense value ("AC 15"). Drawn once per look into a cached
 * canvas texture. The vital glyphs are the shared drop and skull (theme/glyphs.ts, statusSprites.ts).
 */
import { CanvasTexture, SpriteMaterial, SRGBColorSpace } from 'three'
import type { VitalState } from './tokenHud'
import { vitalMaterial } from './statusSprites'
import { LABEL_GLASS, PARCHMENT, MEASURE } from '@/ui/theme/palette'

const materials = new Map<string, SpriteMaterial>()

function texture(key: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): SpriteMaterial {
  let m = materials.get(key)
  if (m) return m
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d')!, w, h)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  m = new SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })
  materials.set(key, m)
  return m
}

/** A shield-ish rounded tag with "AC 15". */
function defenseMaterial(text: string): SpriteMaterial {
  return texture(`def:${text}`, (ctx, w, h) => {
    ctx.fillStyle = LABEL_GLASS
    ctx.strokeStyle = MEASURE
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.roundRect(3, 3, w - 6, h - 6, 14)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = PARCHMENT
    ctx.font = 'bold 30px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + 2)
  }, 128, 56)
}

const noRaycast = () => undefined

export function CombatBadges({ vital, defense, radius }: { vital: VitalState | null; defense: string | null; radius: number }) {
  // Just in front of the disc, either side of the HP bar's ends.
  const z = radius * 1.12
  const y = radius * 0.3
  const s = radius * 0.5
  return (
    <>
      {vital && (
        <sprite material={vitalMaterial(vital)} position={[-radius * 1.15, y, z]} scale={[s, s, 1]} renderOrder={8} raycast={noRaycast} />
      )}
      {defense && (
        <sprite material={defenseMaterial(defense)} position={[radius * 1.25, y, z]} scale={[s * 2.2, s * 0.96, 1]} renderOrder={8} raycast={noRaycast} />
      )}
    </>
  )
}
