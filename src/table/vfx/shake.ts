/**
 * Camera shake driven by `vfxBus` 'shake' events. Additive: each frame the previous offset is
 * removed before the new one is applied, so it coexists with rigs and OrbitControls that write
 * the camera position themselves (their lerps absorb the sub-centimeter residue).
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { vfxBus } from './bus'

export interface CameraShakeOptions {
  /** World-unit displacement at strength 1. Default 0.18 (a cell is ~1.5). */
  amplitude?: number
  /** Oscillations per second. Default 26. */
  frequency?: number
  /** Set false to leave the camera alone and only track `current`. */
  enabled?: boolean
}

interface Shake { strength: number; duration: number; start: number }

export interface CameraShakeHandle {
  /** Current 0..1 shake strength (decays over each request's duration). */
  readonly current: { value: number }
}

function wobble(t: number, salt: number): number {
  return Math.sin(t * 6.2832 + salt * 7.3) * (0.6 + 0.4 * Math.sin(t * 2.3 + salt * 1.7))
}

/** Subscribe the active camera to shake requests. Call inside the <Canvas>. */
export function useCameraShake({ amplitude = 0.18, frequency = 26, enabled = true }: CameraShakeOptions = {}): CameraShakeHandle {
  const camera = useThree((s) => s.camera)
  const shakes = useRef<Shake[]>([])
  const applied = useRef(new Vector3())
  const current = useRef({ value: 0 })

  useEffect(() => vfxBus.on('shake', (strength, durationMs) => {
    shakes.current.push({ strength: Math.min(1, Math.max(0, strength)), duration: Math.max(0.05, durationMs / 1000), start: -1 })
  }), [])

  useFrame((state) => {
    if (applied.current.lengthSq() > 0) {
      camera.position.sub(applied.current)
      applied.current.set(0, 0, 0)
    }
    if (!shakes.current.length) { current.current.value = 0; return }
    const now = state.clock.elapsedTime
    let amp = 0
    shakes.current = shakes.current.filter((sh) => {
      if (sh.start < 0) sh.start = now
      const t = (now - sh.start) / sh.duration
      if (t >= 1) return false
      amp = Math.max(amp, sh.strength * (1 - t) * (1 - t))
      return true
    })
    current.current.value = amp
    if (amp <= 0 || !enabled) return
    const f = now * frequency
    applied.current.set(wobble(f, 1), wobble(f * 0.9, 2) * 0.6, wobble(f * 1.1, 3)).multiplyScalar(amp * amplitude)
    camera.position.add(applied.current)
  })

  return { current: current.current }
}

/** Component form of `useCameraShake` for hosts that prefer JSX. */
export function CameraShake(props: CameraShakeOptions) {
  useCameraShake(props)
  return null
}
