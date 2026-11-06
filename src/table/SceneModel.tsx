/** Renders a loaded scene: its meshes, and its lights with shadows (capped) and flicker. */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DirectionalLight, Light, Material, Mesh, PointLight, SpotLight, Vector3 } from 'three'
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

  // Walls (meshes named WALL_* or wall_*) fade out when the camera looks down from above so a
  // room does not read as a picture frame in orbit view. Materials are cloned per wall mesh.
  const walls = useMemo(() => {
    const out: { mesh: Mesh; mats: Material[] }[] = []
    loaded.root.traverse((o) => {
      if (!(o instanceof Mesh) || !/^wall[_.]/i.test(o.name)) return
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const c = (m as Material).clone()
        c.transparent = true
        return c
      })
      o.material = mats.length === 1 ? mats[0]! : mats
      o.castShadow = true
      out.push({ mesh: o, mats })
    })
    return out
  }, [loaded])
  useEffect(() => () => { for (const w of walls) for (const m of w.mats) m.dispose() }, [walls])

  const dir = useMemo(() => new Vector3(), [])
  useFrame(({ camera }) => {
    if (walls.length === 0) return
    camera.getWorldDirection(dir)
    // pitch: 0 = horizontal, 1 = straight down
    const down = Math.max(0, -dir.y)
    const t = Math.min(1, Math.max(0, (down - 0.35) / 0.35))
    const opacity = 1 - 0.85 * t
    for (const w of walls) {
      for (const m of w.mats) {
        if (m.opacity !== opacity) { m.opacity = opacity; m.depthWrite = opacity > 0.95 }
      }
    }
  })

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
