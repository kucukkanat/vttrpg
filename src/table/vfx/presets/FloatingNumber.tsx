/**
 * A damage or heal number that pops above a token, rises and fades. Crits and knock-downs
 * (`spec.tier`) are drawn larger, in their own colour with a word tag, and pop harder. One camera-facing sprite
 * with a canvas texture drawn once at spawn; the per-frame work is a position and an opacity.
 * The sprite ignores size attenuation so the number stays legible at any zoom, phones included.
 */
import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three'
import { easeOutCubic, easeOutQuad, useLifetime } from './common'
import { prefersReducedMotion } from '@/ui/feedback/prefs'
import { formatDelta, type FloatingNumberSpec } from '../numbers'

const TEX_W = 256
const TEX_H = 128
/** Sprite height as a fraction of the viewport height (size attenuation off). */
const SCREEN_HEIGHT = 0.055

/** Big number with a small resource tag after it, outlined for contrast on any floor. */
export function drawNumber(ctx: CanvasRenderingContext2D, text: string, tag: string, color: string): void {
  ctx.clearRect(0, 0, TEX_W, TEX_H)
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.font = `900 84px system-ui, -apple-system, "Segoe UI", sans-serif`
  const numW = ctx.measureText(text).width
  ctx.font = `700 34px system-ui, -apple-system, "Segoe UI", sans-serif`
  const tagW = tag ? ctx.measureText(tag).width + 10 : 0
  const x0 = (TEX_W - numW - tagW) / 2
  ctx.font = `900 84px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'left'
  ctx.lineWidth = 12
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, x0, TEX_H / 2)
  ctx.fillStyle = color
  ctx.fillText(text, x0, TEX_H / 2)
  if (tag) {
    ctx.font = `700 34px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.lineWidth = 8
    ctx.strokeText(tag, x0 + numW + 10, TEX_H / 2 + 18)
    ctx.fillStyle = '#f6efe3'
    ctx.fillText(tag, x0 + numW + 10, TEX_H / 2 + 18)
  }
}

function makeTexture(text: string, tag: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  drawNumber(canvas.getContext('2d')!, text, tag, color)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

export function FloatingNumber({ spec, onDone }: { spec: FloatingNumberSpec; onDone: () => void }) {
  const { material, sprite } = useMemo(() => {
    const map = makeTexture(formatDelta(spec.delta), spec.resource, spec.color)
    const material = new SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, toneMapped: false })
    const sprite = new Sprite(material)
    sprite.position.set(spec.position.x, spec.position.y, spec.position.z)
    sprite.scale.set(SCREEN_HEIGHT * (TEX_W / TEX_H), SCREEN_HEIGHT, 1)
    sprite.frustumCulled = false
    sprite.renderOrder = 20
    return { material, sprite }
  }, [spec])
  useEffect(() => () => { material.map?.dispose(); material.dispose() }, [material])

  // Reduced motion: the number appears in place, at size, and fades; no rise and no pop.
  const still = useMemo(() => prefersReducedMotion(), [])
  const rise = still ? 0 : spec.cellSize * (spec.tier === 'normal' ? 0.9 : 0.6)
  const popAmount = still ? 0 : spec.tier === 'crit' ? 0.7 : spec.tier === 'down' ? 0.5 : 0.35
  const height = SCREEN_HEIGHT * spec.scale
  useLifetime(spec.duration, (t) => {
    sprite.position.y = spec.position.y + rise * easeOutCubic(t)
    const pop = 1 + popAmount * (1 - easeOutQuad(Math.min(1, t / 0.25)))
    sprite.scale.set(height * (TEX_W / TEX_H) * pop, height * pop, 1)
    material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
  }, onDone)

  return <primitive object={sprite} />
}
