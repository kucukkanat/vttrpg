/**
 * `aura`: soft glow particles orbiting and rising around a token for the duration, plus a dim
 * body glow. Particle motion is closed-form on the GPU; the CPU writes three uniforms per frame.
 */
import { useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Sprite, SpriteMaterial, Vector3 } from 'three'
import type { ScheduledEffect } from '../schedule'
import { GLSL_POINT_COMMON, clamp01, glowTexture, hash, hexToColor, pointScale, useLifetime, useResource } from './common'

const COUNT = 48

const VERT = /* glsl */ `
  uniform float uTime, uScale, uSize, uHeight, uEnv;
  uniform vec3 uCenter;
  attribute float aAngle, aRadius, aSpeed, aPhase, aSeed;
  varying float vAlpha;
  void main() {
    float ang = aAngle + uTime * aSpeed;
    float h = fract(aPhase + uTime * 0.3);
    vec3 p = uCenter + vec3(cos(ang) * aRadius, h * uHeight, sin(ang) * aRadius);
    vAlpha = sin(h * 3.14159) * uEnv;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + aSeed) * uScale / max(0.1, -mv.z);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  ${GLSL_POINT_COMMON}
  void main() {
    float d = softDisc(gl_PointCoord);
    if (d <= 0.001 || vAlpha <= 0.001) discard;
    gl_FragColor = vec4(uColor * d * vAlpha * 0.9, d * vAlpha);
    #include <colorspace_fragment>
  }
`

export function AuraEffect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const cell = effect.cellSize
  const { ground, chest } = effect.from!
  const height = Math.max(0.3 * cell, 2 * (chest.y - ground.y))
  const radius = cell * 0.42

  const geometry = useResource(() => {
    const angle = new Float32Array(COUNT), rad = new Float32Array(COUNT), speed = new Float32Array(COUNT), phase = new Float32Array(COUNT), seed = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      angle[i] = hash(i, 11) * Math.PI * 2
      rad[i] = radius * (0.55 + 0.45 * hash(i, 12))
      speed[i] = (0.6 + 1.2 * hash(i, 13)) * (hash(i, 14) < 0.5 ? -1 : 1)
      phase[i] = hash(i, 15)
      seed[i] = hash(i, 16)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 3), 3))
    g.setAttribute('aAngle', new BufferAttribute(angle, 1))
    g.setAttribute('aRadius', new BufferAttribute(rad, 1))
    g.setAttribute('aSpeed', new BufferAttribute(speed, 1))
    g.setAttribute('aPhase', new BufferAttribute(phase, 1))
    g.setAttribute('aSeed', new BufferAttribute(seed, 1))
    return g
  })
  const material = useResource(() => new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1000 }, uSize: { value: cell * 0.09 }, uHeight: { value: height }, uEnv: { value: 0 },
      uCenter: { value: new Vector3(ground.x, ground.y, ground.z) }, uColor: { value: hexToColor(effect.color) },
    },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }))
  // The body glow sits inside the token mesh, so it ignores depth like the flashes do.
  const glowMat = useResource(() => new SpriteMaterial({ map: glowTexture(), color: hexToColor(effect.color), transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false, opacity: 0 }))
  const { points, glow } = useMemo(() => {
    const points = new Points(geometry, material)
    points.frustumCulled = false
    const glow = new Sprite(glowMat)
    glow.position.set(chest.x, chest.y, chest.z)
    glow.scale.setScalar(cell * 1.1)
    glow.frustumCulled = false
    return { points, glow }
  }, [geometry, material, glowMat, chest, cell])

  useLifetime(effect.duration, (t, elapsed, state) => {
    // Fade in over the first 15%, out over the last 30%.
    const env = Math.min(clamp01(t / 0.15), clamp01((1 - t) / 0.3))
    material.uniforms.uTime.value = elapsed
    material.uniforms.uScale.value = pointScale(state)
    material.uniforms.uEnv.value = env
    glowMat.opacity = 0.28 * env * (0.85 + 0.15 * Math.sin(elapsed * 6))
  }, onDone)

  return (
    <>
      <primitive object={points} />
      <primitive object={glow} />
    </>
  )
}
