/**
 * Shared bits for the three-dependent presets: a lazily built glow texture, point-size scaling,
 * easing, and a `useLifetime` hook that drives a 0..1 progress and reports completion once.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type RootState } from '@react-three/fiber'
import { CanvasTexture, Color, PerspectiveCamera, SRGBColorSpace } from 'three'
import { advanceClock } from '../hitStop'

let glow: CanvasTexture | null = null
let puff: CanvasTexture | null = null

/** 64px radial gradient, white center to transparent. Shared, never disposed. */
export function glowTexture(): CanvasTexture {
  if (glow) return glow
  glow = radial(64, (g) => {
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.15)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
  })
  return glow
}

/** Softer, wider falloff for fog billboards. */
export function puffTexture(): CanvasTexture {
  if (puff) return puff
  puff = radial(128, (g) => {
    g.addColorStop(0, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.3)')
    g.addColorStop(0.8, 'rgba(255,255,255,0.06)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
  })
  return puff
}

function radial(size: number, stops: (g: CanvasGradient) => void): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  stops(g)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/**
 * Multiplier turning a world-space size into `gl_PointSize` pixels at depth 1:
 * drawingBufferHeight / (2 tan(fov/2)). Divide by -mvPosition.z in the shader.
 */
export function pointScale(state: RootState): number {
  const cam = state.camera
  const fov = cam instanceof PerspectiveCamera ? cam.fov : 50
  const h = state.gl.domElement.height || state.size.height * state.viewport.dpr
  return h / (2 * Math.tan((fov * Math.PI) / 360))
}

export function hexToColor(css: string): Color {
  const c = new Color()
  try { c.set(css) } catch { c.set('#ffffff') }
  return c
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t)
export const easeInQuad = (t: number) => t * t

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Seeded-ish deterministic noise, enough for particle variety. */
export function hash(i: number, salt = 0): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Drives an effect's lifetime. `onFrame(t, elapsedSeconds)` runs every frame with `t` in 0..1;
 * `onDone` fires once after `durationMs` (+ `tailMs`). The clock holds still during a hit-stop
 * (../hitStop.ts). Returns a ref to the elapsed seconds.
 */
export function useLifetime(durationMs: number, onFrame: (t: number, elapsed: number, state: RootState) => void, onDone: () => void, tailMs = 0) {
  const clock = useRef<number | null>(null)
  const done = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  useFrame((state, dt) => {
    // The first frame starts the clock at zero; later frames add what the hit-stop lets through.
    clock.current = clock.current === null ? 0 : advanceClock(clock.current, dt, performance.now())
    const elapsed = clock.current
    const t = clamp01((elapsed * 1000) / Math.max(1, durationMs))
    onFrameRef.current(t, elapsed, state)
    if (!done.current && elapsed * 1000 >= durationMs + tailMs) {
      done.current = true
      onDoneRef.current()
    }
  })
  return clock
}

/** Dispose three resources made in a `useMemo` when the component unmounts. */
export function useDispose(...objects: { dispose(): void }[]) {
  const ref = useRef(objects)
  ref.current = objects
  useEffect(() => () => { for (const o of ref.current) o.dispose() }, [])
}

/** Memoize a three resource for the component's lifetime and dispose it on unmount. */
export function useResource<T extends { dispose(): void }>(make: () => T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(make, [])
  useEffect(() => () => value.dispose(), [value])
  return value
}

/** GLSL helpers shared by the point shaders. */
export const GLSL_POINT_COMMON = /* glsl */ `
  float softDisc(vec2 pc) {
    vec2 d = pc - 0.5;
    float r2 = dot(d, d) * 4.0;
    return clamp(1.0 - r2, 0.0, 1.0);
  }
`
