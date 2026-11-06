/** Snow: slow drifting flakes wrapped inside the bounds on the GPU. <= 800 points. */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial, Vector2 } from 'three'
import { GLSL_POINT_COMMON, hash, hexToColor, pointScale, useResource } from '../presets/common'
import { particleBudget, SNOW_MAX, weatherBox, type WeatherBounds } from './bounds'

export interface SnowProps {
  bounds: WeatherBounds
  density?: number
  color?: string
  wind?: [number, number]
}

const VERT = /* glsl */ `
  uniform float uTime, uScale, uSize, uMinY, uHeight, uMinX, uWidth, uMinZ, uDepth;
  uniform vec2 uWind;
  attribute float aSpeed, aPhase, aSeed;
  varying float vAlpha;
  void main() {
    float y = uMinY + mod(position.y - uMinY - aSpeed * uTime, uHeight);
    float sway = sin(uTime * (0.6 + aSeed) + aPhase * 6.2831) * 0.35;
    float x = uMinX + mod(position.x - uMinX + uWind.x * uTime + sway, uWidth);
    float z = uMinZ + mod(position.z - uMinZ + uWind.y * uTime + cos(uTime * (0.5 + aSeed * 0.7) + aPhase * 4.0) * 0.25, uDepth);
    float h = (y - uMinY) / uHeight;
    vAlpha = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.9, 1.0, h));
    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + 0.8 * aSeed) * uScale / max(0.1, -mv.z);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  ${GLSL_POINT_COMMON}
  void main() {
    float d = softDisc(gl_PointCoord);
    float a = d * d * 0.9 * vAlpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`

export function Snow({ bounds, density = 1, color = '#f4f7ff', wind = [0.25, 0.1] }: SnowProps) {
  const box = useMemo(() => weatherBox(bounds, 4), [bounds])
  const count = particleBudget(box.area, 3, 120, SNOW_MAX, density)

  const geometry = useResource(() => {
    const pos = new Float32Array(count * 3)
    const speed = new Float32Array(count)
    const phase = new Float32Array(count)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.minX + hash(i, 41) * box.width
      pos[i * 3 + 1] = box.minY + hash(i, 42) * box.height
      pos[i * 3 + 2] = box.minZ + hash(i, 43) * box.depth
      speed[i] = 0.5 + 0.7 * hash(i, 44)
      phase[i] = hash(i, 45)
      seed[i] = hash(i, 46)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aSpeed', new BufferAttribute(speed, 1))
    g.setAttribute('aPhase', new BufferAttribute(phase, 1))
    g.setAttribute('aSeed', new BufferAttribute(seed, 1))
    return g
  })
  const material = useResource(() => new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1000 }, uSize: { value: 0.07 },
      uMinY: { value: box.minY }, uHeight: { value: box.height }, uMinX: { value: box.minX }, uWidth: { value: box.width }, uMinZ: { value: box.minZ }, uDepth: { value: box.depth },
      uWind: { value: new Vector2(wind[0], wind[1]) }, uColor: { value: hexToColor(color) },
    },
    transparent: true, depthWrite: false, blending: NormalBlending, toneMapped: false,
  }))
  const points = useMemo(() => {
    const p = new Points(geometry, material)
    p.frustumCulled = false
    return p
  }, [geometry, material])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    material.uniforms.uScale.value = pointScale(state)
  })

  return <primitive object={points} />
}
