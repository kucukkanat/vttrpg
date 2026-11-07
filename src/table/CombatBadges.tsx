/**
 * Small camera-facing badges on a token's footprint, next to the HP bar: the bloodied / down
 * glyph (`vitalState`) and the pack's defense value ("AC 15"). Drawn once per look into a cached
 * canvas texture. This is the display hook for those states; the visual design can restyle the
 * glyphs here without touching how they are derived (tokenHud.ts).
 */
import { CanvasTexture, SpriteMaterial, SRGBColorSpace } from 'three'
import type { VitalState } from './tokenHud'

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

/** A blood drop for bloodied, a skull for down. */
function vitalMaterial(state: VitalState): SpriteMaterial {
  return texture(`vital:${state}`, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(14,14,16,0.85)'
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
    if (state === 'bloodied') {
      ctx.fillStyle = '#e0453a'
      ctx.beginPath()
      ctx.moveTo(w / 2, h * 0.18)
      ctx.bezierCurveTo(w * 0.78, h * 0.5, w * 0.76, h * 0.8, w / 2, h * 0.8)
      ctx.bezierCurveTo(w * 0.24, h * 0.8, w * 0.22, h * 0.5, w / 2, h * 0.18)
      ctx.fill()
    } else {
      ctx.fillStyle = '#f3ead8'
      ctx.beginPath()
      ctx.arc(w / 2, h * 0.44, w * 0.26, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(w * 0.36, h * 0.56, w * 0.28, h * 0.2)
      ctx.fillStyle = 'rgba(14,14,16,1)'
      ctx.beginPath()
      ctx.arc(w * 0.4, h * 0.44, w * 0.07, 0, Math.PI * 2)
      ctx.arc(w * 0.6, h * 0.44, w * 0.07, 0, Math.PI * 2)
      ctx.fill()
    }
  }, 64, 64)
}

/** A shield-ish rounded tag with "AC 15". */
function defenseMaterial(text: string): SpriteMaterial {
  return texture(`def:${text}`, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(14,14,16,0.85)'
    ctx.strokeStyle = '#c9c3b8'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.roundRect(3, 3, w - 6, h - 6, 14)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#f3ead8'
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
