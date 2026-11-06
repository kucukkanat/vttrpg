/**
 * One-shot GPU particle burst: every particle's path is a closed form of time, so the CPU only
 * bumps two uniforms per frame. Used by `hit`, the projectile impact and the ring.
 */
import { useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three'
import type { Vec3 } from '@/core/geometry'
import { GLSL_POINT_COMMON, hash, hexToColor, pointScale, useLifetime, useResource } from './common'

export interface BurstProps {
  center: Vec3
  color: string
  count: number
  durationMs: number
  /** Initial speed in world units per second. */
  speed: number
  /** Particle diameter in world units. */
  size: number
  /** Downward acceleration (world units / s²). */
  gravity?: number
  /** Velocity damping; higher stops the sparks sooner. */
  drag?: number
  /** `sphere`: all directions; `up`: upward hemisphere; `disc`: outward along the ground. */
  spread?: 'sphere' | 'up' | 'disc'
  /** Spawn jitter radius in world units. */
  jitter?: number
  seed?: number
  onDone?: () => void
}

const VERT = /* glsl */ `
  uniform float uTime, uScale, uSize, uGravity, uDrag;
  attribute vec3 aVel;
  attribute float aDelay, aLife, aSeed;
  varying float vAlpha;
  void main() {
    float age = max(uTime - aDelay, 0.0);
    float t = clamp(age / aLife, 0.0, 1.0);
    float s = (1.0 - exp(-uDrag * age)) / uDrag;
    vec3 p = position + aVel * s + vec3(0.0, -0.5 * uGravity * age * age, 0.0);
    float live = step(aDelay, uTime) * (1.0 - step(0.999, t));
    vAlpha = (1.0 - t) * (1.0 - t) * live;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + 0.6 * aSeed) * (1.0 - 0.6 * t) * uScale / max(0.1, -mv.z) * live;
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  ${GLSL_POINT_COMMON}
  void main() {
    float d = softDisc(gl_PointCoord);
    if (d <= 0.001 || vAlpha <= 0.001) discard;
    vec3 col = mix(uColor, vec3(1.0), d * d * 0.6) * d * vAlpha;
    gl_FragColor = vec4(col, d * vAlpha);
    #include <colorspace_fragment>
  }
`

export function Burst({ center, color, count, durationMs, speed, size, gravity = 2.5, drag = 3, spread = 'sphere', jitter = 0, seed = 1, onDone }: BurstProps) {
  const geometry = useResource(() => makeGeometry(count, center, speed, durationMs / 1000, spread, jitter, seed))
  const material = useResource(() => new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1000 }, uSize: { value: size }, uGravity: { value: gravity }, uDrag: { value: Math.max(0.01, drag) },
      uColor: { value: hexToColor(color) },
    },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }))
  const points = useMemo(() => {
    const p = new Points(geometry, material)
    p.frustumCulled = false
    return p
  }, [geometry, material])

  useLifetime(durationMs, (_t, elapsed, state) => {
    material.uniforms.uTime.value = elapsed
    material.uniforms.uScale.value = pointScale(state)
  }, () => onDone?.(), 80)

  return <primitive object={points} />
}

function makeGeometry(count: number, center: Vec3, speed: number, lifeSec: number, spread: BurstProps['spread'], jitter: number, seed: number): BufferGeometry {
  const n = Math.max(1, Math.floor(count))
  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const delay = new Float32Array(n)
  const life = new Float32Array(n)
  const seeds = new Float32Array(n)
  const dir = new Vector3()
  for (let i = 0; i < n; i++) {
    const k = i + seed * 101
    const r1 = hash(k, 1), r2 = hash(k, 2), r3 = hash(k, 3), r4 = hash(k, 4)
    // Uniform direction on the sphere.
    const z = r1 * 2 - 1
    const phi = r2 * Math.PI * 2
    const rr = Math.sqrt(Math.max(0, 1 - z * z))
    dir.set(rr * Math.cos(phi), z, rr * Math.sin(phi))
    if (spread === 'up') dir.y = Math.abs(dir.y) * 0.9 + 0.1
    if (spread === 'disc') { dir.y = (r3 - 0.5) * 0.15; dir.normalize() }
    const sp = speed * (0.35 + 0.65 * r3)
    vel[i * 3] = dir.x * sp
    vel[i * 3 + 1] = dir.y * sp
    vel[i * 3 + 2] = dir.z * sp
    pos[i * 3] = center.x + (hash(k, 5) - 0.5) * 2 * jitter
    pos[i * 3 + 1] = center.y + (hash(k, 6) - 0.5) * 2 * jitter
    pos[i * 3 + 2] = center.z + (hash(k, 7) - 0.5) * 2 * jitter
    delay[i] = r4 * lifeSec * 0.12
    life[i] = lifeSec * (0.55 + 0.45 * hash(k, 8))
    seeds[i] = hash(k, 9)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aVel', new BufferAttribute(vel, 3))
  g.setAttribute('aDelay', new BufferAttribute(delay, 1))
  g.setAttribute('aLife', new BufferAttribute(life, 1))
  g.setAttribute('aSeed', new BufferAttribute(seeds, 1))
  return g
}
