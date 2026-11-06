/** Embers: rising orange sparks that flicker and die out near the top of the volume. <= 400 points. */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three'
import { GLSL_POINT_COMMON, hash, hexToColor, pointScale, useResource } from '../presets/common'
import { EMBERS_MAX, particleBudget, weatherBox, type WeatherBounds } from './bounds'

export interface EmbersProps {
  bounds: WeatherBounds
  density?: number
  color?: string
}

const VERT = /* glsl */ `
  uniform float uTime, uScale, uSize, uMinY, uHeight, uMinX, uWidth, uMinZ, uDepth;
  attribute float aSpeed, aPhase, aSeed;
  varying float vAlpha;
  varying float vHeat;
  void main() {
    float y = uMinY + mod(position.y - uMinY + aSpeed * uTime, uHeight);
    float h = (y - uMinY) / uHeight;
    float x = uMinX + mod(position.x - uMinX + sin(uTime * (0.8 + aSeed) + aPhase * 6.2831) * 0.3 + uTime * 0.15, uWidth);
    float z = uMinZ + mod(position.z - uMinZ + cos(uTime * (0.6 + aSeed * 0.5) + aPhase * 5.0) * 0.3, uDepth);
    float flicker = 0.7 + 0.3 * sin(uTime * (6.0 + 9.0 * aSeed) + aPhase * 40.0);
    vAlpha = flicker * smoothstep(0.0, 0.06, h) * (1.0 - h * h);
    vHeat = 1.0 - h;
    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + aSeed) * uScale / max(0.1, -mv.z);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vHeat;
  ${GLSL_POINT_COMMON}
  void main() {
    float d = softDisc(gl_PointCoord);
    float a = d * d * vAlpha;
    if (a <= 0.003) discard;
    vec3 cold = uColor * vec3(0.7, 0.25, 0.1);
    vec3 col = mix(cold, mix(uColor, vec3(1.0, 0.95, 0.8), d * d * 0.6), vHeat) * 1.6;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`

export function Embers({ bounds, density = 1, color = '#ff8a2a' }: EmbersProps) {
  const box = useMemo(() => weatherBox(bounds, 3), [bounds])
  const count = particleBudget(box.area, 1.5, 60, EMBERS_MAX, density)

  const geometry = useResource(() => {
    const pos = new Float32Array(count * 3)
    const speed = new Float32Array(count)
    const phase = new Float32Array(count)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.minX + hash(i, 51) * box.width
      pos[i * 3 + 1] = box.minY + hash(i, 52) * box.height
      pos[i * 3 + 2] = box.minZ + hash(i, 53) * box.depth
      speed[i] = 0.35 + 0.65 * hash(i, 54)
      phase[i] = hash(i, 55)
      seed[i] = hash(i, 56)
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
      uTime: { value: 0 }, uScale: { value: 1000 }, uSize: { value: 0.085 },
      uMinY: { value: box.minY }, uHeight: { value: box.height }, uMinX: { value: box.minX }, uWidth: { value: box.width }, uMinZ: { value: box.minZ }, uDepth: { value: box.depth },
      uColor: { value: hexToColor(color) },
    },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
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
