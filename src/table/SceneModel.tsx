/** Renders a loaded scene: its meshes, and its lights with shadows (capped) and flicker. */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DirectionalLight, Light, PointLight, SpotLight } from 'three'
import type { LoadedScene } from './sceneLoader'

export const MAX_SHADOW_CASTERS = 4
const SHADOW_MAP = 1024

/** Smooth pseudo-random flame flicker in roughly [-1, 1]. */
export function flickerNoise(t: number, seed: number): number {
  const s = seed * 1.7
  return 0.5 * Math.sin(t * 7.3 + s) + 0.3 * Math.sin(t * 13.1 + s * 2.3) + 0.2 * Math.sin(t * 23.7 + s * 3.1)
}

export function SceneModel({ loaded }: { loaded: LoadedScene }) {
  useEffect(() => {
    let casters = 0
    for (const { object } of loaded.lights) {
      if (object instanceof PointLight || object instanceof SpotLight || object instanceof DirectionalLight) {
        const cast = casters < MAX_SHADOW_CASTERS
        object.castShadow = cast
        if (cast) {
          casters++
          object.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
          object.shadow.bias = -0.0008
          object.shadow.normalBias = 0.02
          object.shadow.camera.near = 0.1
          if (!(object instanceof DirectionalLight)) object.shadow.camera.far = 60
        }
      }
    }
  }, [loaded])

  const bases = useMemo(() => loaded.lights.map((l) => (l.object as Light).intensity), [loaded])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let i = 0; i < loaded.lights.length; i++) {
      const { object, flicker } = loaded.lights[i]!
      if (!flicker) continue
      ;(object as Light).intensity = bases[i]! * (1 + 0.35 * flicker * flickerNoise(t, i))
    }
  })

  return <primitive object={loaded.root} />
}
