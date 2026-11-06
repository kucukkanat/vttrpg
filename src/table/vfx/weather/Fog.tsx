/** Fog: a handful of large, soft, translucent billboards drifting slowly through the volume. */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, NormalBlending, Sprite, SpriteMaterial } from 'three'
import { hash, hexToColor, puffTexture, useResource } from '../presets/common'
import { FOG_MAX, particleBudget, weatherBox, type WeatherBounds } from './bounds'

export interface FogProps {
  bounds: WeatherBounds
  density?: number
  color?: string
  /** Peak opacity per billboard. */
  opacity?: number
  wind?: [number, number]
}

interface Puff { sprite: Sprite; vx: number; vz: number; phase: number; base: number }

export function Fog({ bounds, density = 1, color = '#d3dae3', opacity = 0.5, wind = [0.12, 0.04] }: FogProps) {
  const box = useMemo(() => weatherBox(bounds, 2), [bounds])
  const count = particleBudget(box.area, 1 / 20, 5, FOG_MAX, density)
  const size = Math.min(12, Math.max(3, 0.5 * Math.max(box.width, box.depth)))

  const material = useResource(() => new SpriteMaterial({ map: puffTexture(), color: hexToColor(color), transparent: true, depthWrite: false, blending: NormalBlending, toneMapped: false, opacity }))
  const { group, puffs } = useMemo(() => {
    const group = new Group()
    const puffs: Puff[] = []
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite(material)
      sprite.position.set(box.minX + hash(i, 61) * box.width, box.minY + size * 0.18 + hash(i, 62) * size * 0.25, box.minZ + hash(i, 63) * box.depth)
      const s = size * (0.7 + 0.6 * hash(i, 64))
      sprite.scale.set(s, s * 0.55, 1)
      sprite.frustumCulled = false
      group.add(sprite)
      puffs.push({ sprite, vx: wind[0] * (0.6 + 0.8 * hash(i, 65)), vz: wind[1] * (0.6 + 0.8 * hash(i, 66)) + (hash(i, 67) - 0.5) * 0.06, phase: hash(i, 68) * 6.28, base: s })
    }
    return { group, puffs }
  }, [count, material, box, size, wind])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const step = Math.min(dt, 0.1)
    for (const p of puffs) {
      const pos = p.sprite.position
      pos.x += p.vx * step
      pos.z += p.vz * step
      if (pos.x > box.minX + box.width + p.base * 0.5) pos.x = box.minX - p.base * 0.5
      if (pos.x < box.minX - p.base * 0.5) pos.x = box.minX + box.width + p.base * 0.5
      if (pos.z > box.minZ + box.depth + p.base * 0.5) pos.z = box.minZ - p.base * 0.5
      if (pos.z < box.minZ - p.base * 0.5) pos.z = box.minZ + box.depth + p.base * 0.5
      const breathe = 1 + 0.06 * Math.sin(t * 0.3 + p.phase)
      p.sprite.scale.set(p.base * breathe, p.base * 0.55 * breathe, 1)
    }
  })

  return <primitive object={group} />
}
