/**
 * `projectile`: a glowing bolt flies from source to target along a shallow arc, dragging a short
 * trail; on arrival a small impact burst and flash play. The trail is 24 points updated on the CPU.
 */
import { useMemo, useState } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Sprite, SpriteMaterial, Vector3 } from 'three'
import { aimPoint, type ScheduledEffect } from '../schedule'
import { Burst } from './Burst'
import { Flash } from './Flash'
import { GLSL_POINT_COMMON, clamp01, glowTexture, hexToColor, pointScale, useLifetime, useResource } from './common'

const TRAIL = 24
const TRAIL_LAG = 0.022 // fraction of the flight per trail point
const IMPACT_MS = 260

const VERT = /* glsl */ `
  uniform float uScale, uSize, uAlpha;
  attribute float aIdx;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float k = 1.0 - aIdx;
    vAlpha = k * k * uAlpha;
    gl_PointSize = uSize * (0.35 + 0.65 * k) * uScale / max(0.1, -mv.z);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  ${GLSL_POINT_COMMON}
  void main() {
    float d = softDisc(gl_PointCoord);
    if (d <= 0.001 || vAlpha <= 0.001) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), d * 0.4) * d * vAlpha, d * vAlpha);
    #include <colorspace_fragment>
  }
`

export function ProjectileEffect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const cell = effect.cellSize
  const start = effect.from!.chest
  const end = aimPoint(effect.to!, cell)
  const [arrived, setArrived] = useState(false)

  const path = useMemo(() => {
    const a = new Vector3(start.x, start.y, start.z)
    const b = new Vector3(end.x, end.y, end.z)
    const dist = a.distanceTo(b)
    const lift = Math.min(1.5 * cell, Math.max(0.15 * cell, dist * 0.2))
    const out = new Vector3()
    return (t: number, target = out) => {
      const k = clamp01(t)
      target.lerpVectors(a, b, k)
      target.y += lift * Math.sin(Math.PI * k)
      return target
    }
  }, [start, end, cell])

  const boltMat = useResource(() => new SpriteMaterial({ map: glowTexture(), color: hexToColor(effect.color).lerp(hexToColor('#ffffff'), 0.3), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }))
  const trailGeo = useResource(() => {
    const g = new BufferGeometry()
    const pos = new Float32Array(TRAIL * 3)
    const idx = new Float32Array(TRAIL)
    for (let i = 0; i < TRAIL; i++) { idx[i] = i / (TRAIL - 1); pos[i * 3] = start.x; pos[i * 3 + 1] = start.y; pos[i * 3 + 2] = start.z }
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aIdx', new BufferAttribute(idx, 1))
    return g
  })
  const trailMat = useResource(() => new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uScale: { value: 1000 }, uSize: { value: cell * 0.16 }, uAlpha: { value: 1 }, uColor: { value: hexToColor(effect.color) } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }))
  const { bolt, trail } = useMemo(() => {
    const bolt = new Sprite(boltMat)
    bolt.scale.setScalar(cell * 0.38)
    bolt.position.set(start.x, start.y, start.z)
    bolt.frustumCulled = false
    const trail = new Points(trailGeo, trailMat)
    trail.frustumCulled = false
    return { bolt, trail }
  }, [boltMat, trailGeo, trailMat, start, cell])

  const flightMs = effect.duration
  useLifetime(flightMs, (t, elapsed, state) => {
    const p = path(t)
    bolt.position.copy(p)
    bolt.visible = t < 1
    boltMat.opacity = 0.85 + 0.15 * Math.sin(elapsed * 50)
    const attr = trailGeo.getAttribute('position') as BufferAttribute
    const tmp = new Vector3()
    for (let i = 0; i < TRAIL; i++) {
      path(t - i * TRAIL_LAG, tmp)
      attr.setXYZ(i, tmp.x, tmp.y, tmp.z)
    }
    attr.needsUpdate = true
    trailMat.uniforms.uScale.value = pointScale(state)
    // After arrival the trail catches up and fades.
    const over = Math.max(0, elapsed * 1000 - flightMs)
    trailMat.uniforms.uAlpha.value = 1 - clamp01(over / 180)
    if (t >= 1 && !arrived) setArrived(true)
  }, () => { /* finished by the impact burst */ }, 0)

  return (
    <>
      <primitive object={bolt} />
      <primitive object={trail} />
      {arrived && (
        <>
          <Burst center={end} color={effect.color} count={36} durationMs={IMPACT_MS} speed={cell * 1.6} size={cell * 0.06} gravity={cell * 2.5} drag={4} seed={7} onDone={onDone} />
          <Flash center={end} color={effect.color} size={cell * 0.8} durationMs={150} />
        </>
      )}
    </>
  )
}
