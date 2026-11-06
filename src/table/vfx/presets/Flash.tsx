/** A camera-facing glow sprite that pops and fades. The "brief flash" part of hit and impacts. */
import { useMemo } from 'react'
import { AdditiveBlending, Sprite, SpriteMaterial } from 'three'
import type { Vec3 } from '@/core/geometry'
import { easeOutCubic, glowTexture, hexToColor, useLifetime, useResource } from './common'

export interface FlashProps {
  center: Vec3
  color: string
  /** Final diameter in world units. */
  size: number
  durationMs: number
  /** Peak opacity. */
  intensity?: number
  /** Flashes sit at a token's chest, inside its mesh, so by default they ignore depth. */
  depthTest?: boolean
  onDone?: () => void
}

export function Flash({ center, color, size, durationMs, intensity = 1, depthTest = false, onDone }: FlashProps) {
  const material = useResource(() => new SpriteMaterial({
    map: glowTexture(), color: hexToColor(color), transparent: true, depthWrite: false, depthTest, blending: AdditiveBlending, toneMapped: false, opacity: intensity,
  }))
  const sprite = useMemo(() => {
    const s = new Sprite(material)
    s.position.set(center.x, center.y, center.z)
    s.scale.setScalar(size * 0.5)
    s.frustumCulled = false
    s.renderOrder = 10
    return s
  }, [material, center, size])

  useLifetime(durationMs, (t) => {
    const s = size * (0.5 + 0.7 * easeOutCubic(t))
    sprite.scale.set(s, s, 1)
    material.opacity = intensity * (1 - t) * (1 - t)
  }, () => onDone?.())

  return <primitive object={sprite} />
}
