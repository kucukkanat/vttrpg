/**
 * Rain: fast falling streaks (one line segment per drop, wrapped in the shader) over the bounds,
 * plus a sparse layer of ring-shaped splash points on the ground. <= 2000 drops.
 */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, LineSegments, NormalBlending, Points, ShaderMaterial, Vector2 } from 'three'
import { GLSL_POINT_COMMON, hash, hexToColor, pointScale, useResource } from '../presets/common'
import { particleBudget, RAIN_MAX, weatherBox, type WeatherBounds } from './bounds'

export interface RainProps {
  bounds: WeatherBounds
  /** 0..1 scales the drop count; default 1. */
  density?: number
  /** 0..1 overall opacity, for fading a local shower in and out. */
  intensity?: number
  color?: string
  /** Horizontal wind in world units per second (x, z). */
  wind?: [number, number]
}

const DROP_VERT = /* glsl */ `
  uniform float uTime, uMinY, uHeight, uLen, uMinX, uWidth, uMinZ, uDepth;
  uniform vec2 uWind;
  attribute float aEnd, aSpeed;
  varying float vEnd;
  void main() {
    float y = uMinY + mod(position.y - uMinY - aSpeed * uTime, uHeight);
    float x = uMinX + mod(position.x - uMinX + uWind.x * uTime, uWidth);
    float z = uMinZ + mod(position.z - uMinZ + uWind.y * uTime, uDepth);
    vec3 dir = normalize(vec3(uWind.x, -aSpeed, uWind.y));
    vec3 p = vec3(x, y, z) - dir * uLen * aEnd;
    vEnd = aEnd;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`
const DROP_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vEnd;
  void main() {
    gl_FragColor = vec4(uColor, uAlpha * (0.55 - vEnd * 0.5));
    #include <colorspace_fragment>
  }
`
const SPLASH_VERT = /* glsl */ `
  uniform float uTime, uScale, uSize;
  attribute float aPhase, aRate;
  varying float vT;
  void main() {
    float t = fract(uTime * aRate + aPhase);
    vT = t;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.25 + t) * uScale / max(0.1, -mv.z);
  }
`
const SPLASH_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vT;
  ${GLSL_POINT_COMMON}
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float ring = smoothstep(0.5, 0.78, r) * (1.0 - smoothstep(0.78, 1.0, r));
    float a = ring * (1.0 - vT) * 0.45 * uAlpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`

export function Rain({ bounds, density = 1, intensity = 1, color = '#aebfd6', wind = [0.6, 0.2] }: RainProps) {
  const box = useMemo(() => weatherBox(bounds, 4), [bounds])
  const count = particleBudget(box.area, 8, 200, RAIN_MAX, density)
  const splashes = Math.min(300, Math.max(40, Math.round(count / 6)))

  const dropGeo = useResource(() => {
    const pos = new Float32Array(count * 2 * 3)
    const end = new Float32Array(count * 2)
    const speed = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const x = box.minX + hash(i, 21) * box.width
      const y = box.minY + hash(i, 22) * box.height
      const z = box.minZ + hash(i, 23) * box.depth
      const sp = 9 + 5 * hash(i, 24)
      for (let v = 0; v < 2; v++) {
        const j = i * 2 + v
        pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z
        end[j] = v
        speed[j] = sp
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aEnd', new BufferAttribute(end, 1))
    g.setAttribute('aSpeed', new BufferAttribute(speed, 1))
    return g
  })
  const dropMat = useResource(() => new ShaderMaterial({
    vertexShader: DROP_VERT, fragmentShader: DROP_FRAG,
    uniforms: {
      uTime: { value: 0 }, uMinY: { value: box.minY }, uHeight: { value: box.height }, uLen: { value: 0.35 },
      uMinX: { value: box.minX }, uWidth: { value: box.width }, uMinZ: { value: box.minZ }, uDepth: { value: box.depth },
      uWind: { value: new Vector2(wind[0], wind[1]) }, uColor: { value: hexToColor(color) }, uAlpha: { value: intensity },
    },
    transparent: true, depthWrite: false, blending: NormalBlending, toneMapped: false,
  }))
  const splashGeo = useResource(() => {
    const pos = new Float32Array(splashes * 3)
    const phase = new Float32Array(splashes)
    const rate = new Float32Array(splashes)
    for (let i = 0; i < splashes; i++) {
      pos[i * 3] = box.minX + hash(i, 31) * box.width
      pos[i * 3 + 1] = box.minY + 0.015
      pos[i * 3 + 2] = box.minZ + hash(i, 32) * box.depth
      phase[i] = hash(i, 33)
      rate[i] = 1.4 + hash(i, 34) * 1.2
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aPhase', new BufferAttribute(phase, 1))
    g.setAttribute('aRate', new BufferAttribute(rate, 1))
    return g
  })
  const splashMat = useResource(() => new ShaderMaterial({
    vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1000 }, uSize: { value: 0.22 }, uColor: { value: hexToColor(color) }, uAlpha: { value: intensity } },
    transparent: true, depthWrite: false, blending: NormalBlending, toneMapped: false,
  }))
  const { drops, splash } = useMemo(() => {
    const drops = new LineSegments(dropGeo, dropMat)
    drops.frustumCulled = false
    const splash = new Points(splashGeo, splashMat)
    splash.frustumCulled = false
    return { drops, splash }
  }, [dropGeo, dropMat, splashGeo, splashMat])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    dropMat.uniforms.uTime.value = t
    dropMat.uniforms.uAlpha.value = intensity
    splashMat.uniforms.uTime.value = t
    splashMat.uniforms.uAlpha.value = intensity
    splashMat.uniforms.uScale.value = pointScale(state)
  })

  return (
    <>
      <primitive object={drops} />
      <primitive object={splash} />
    </>
  )
}
