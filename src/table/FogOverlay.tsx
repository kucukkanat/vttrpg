/**
 * Fog of war overlay: a plane over the floor whose shader samples a cell-state texture.
 * Unexplored cells are dark, explored-but-not-visible cells are dimmed, visible cells are clear.
 * Visibility comes from CPU line-of-sight against the scene's wall segments. The client also
 * emits `fog.reveal` for cells newly seen by tokens it controls.
 */
import { useEffect, useMemo, useRef } from 'react'
import { DataTexture, LinearFilter, NoColorSpace, RedFormat, ShaderMaterial, UnsignedByteType } from 'three'
import { useGame } from '@/state/store'
import type { Token } from '@/core/doc'
import type { Bounds2 } from './grid'
import { revealsFor, useTable } from './context'
import { useTableUi } from './tableState'
import { computeVisibleCells, fogRasterLayout, rasterizeFog, type Viewer2D } from './vision'
import type { WallSegment } from './walls'

const noRaycast = () => undefined

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const frag = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDark;
  uniform float uDim;
  varying vec2 vUv;
  void main() {
    float v = texture2D(uMap, vUv).r;
    float explored = smoothstep(0.1, 0.4, v);
    float visible = smoothstep(0.6, 0.9, v);
    float a = mix(uDark, uDim, explored) * (1.0 - visible);
    gl_FragColor = vec4(0.02, 0.02, 0.04, a);
  }
`

export function FogOverlay({ bounds, walls }: { bounds: Bounds2; walls: readonly WallSegment[] }) {
  const { grid, floorY, viewer, sceneId, scene, onIntent } = useTable()
  const tokens = useGame((s) => s.tokens)
  const fog = useGame((s) => s.fog[sceneId])
  const drag = useTableUi((s) => s.drag)

  const sceneTokens = useMemo(
    () => Object.values(tokens).filter((t) => t.scene === sceneId && !t.hidden),
    [tokens, sceneId],
  )
  const position = (t: Token): Viewer2D =>
    drag && drag.token === t.id
      ? { x: drag.x, z: drag.z, vision: t.vision }
      : { x: t.position.x, z: t.position.z, vision: t.vision }

  // Cells seen by tokens whose sight this client is responsible for revealing.
  const revealTokens = useMemo(() => sceneTokens.filter((t) => revealsFor(viewer, t)), [sceneTokens, viewer])
  const visibleReveal = useMemo(
    () => computeVisibleCells(grid, revealTokens.map(position), walls),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, revealTokens, walls, drag],
  )
  // What this viewer sees: GM sees through every token; players only through their own.
  const visibleDisplay = useMemo(() => {
    if (!viewer || viewer.isGm) {
      const others = sceneTokens.filter((t) => !revealsFor(viewer, t))
      if (others.length === 0) return visibleReveal
      const out = new Set(visibleReveal)
      for (const k of computeVisibleCells(grid, others.map(position), walls)) out.add(k)
      return out
    }
    return visibleReveal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, sceneTokens, viewer, visibleReveal, walls, drag])

  const explored = useMemo(() => new Set(fog?.revealed ?? []), [fog])

  // Optimistically remember what we already asked to reveal, so we do not re-send every render.
  const pending = useRef<{ scene: string; cells: Set<string> }>({ scene: sceneId, cells: new Set() })
  useEffect(() => {
    if (pending.current.scene !== sceneId) pending.current = { scene: sceneId, cells: new Set() }
    if (drag) return // wait for the drop; the committed position decides what was revealed
    const fresh: string[] = []
    for (const k of visibleReveal) {
      if (explored.has(k) || pending.current.cells.has(k)) continue
      pending.current.cells.add(k)
      fresh.push(k)
    }
    if (fresh.length) onIntent({ type: 'fog.reveal', scene: sceneId, cells: fresh })
  }, [visibleReveal, explored, sceneId, drag, onIntent])

  const layout = useMemo(() => fogRasterLayout(grid, bounds, 4), [grid, bounds])
  const texture = useMemo(() => {
    const tex = new DataTexture(new Uint8Array(layout.width * layout.height), layout.width, layout.height, RedFormat, UnsignedByteType)
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    tex.unpackAlignment = 1
    tex.colorSpace = NoColorSpace
    tex.needsUpdate = true
    return tex
  }, [layout])
  useEffect(() => () => texture.dispose(), [texture])

  const material = useMemo(
    () => new ShaderMaterial({
      uniforms: { uMap: { value: texture }, uDark: { value: 0.9 }, uDim: { value: 0.55 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    }),
    [texture],
  )
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    const all = new Set(explored)
    for (const k of pending.current.cells) all.add(k)
    rasterizeFog(grid, layout, visibleDisplay, all, texture.image.data as Uint8Array)
    texture.needsUpdate = true
  }, [grid, layout, visibleDisplay, explored, texture])

  const darkness = Math.min(1, Math.max(0, scene.darkness))
  const gm = !viewer || viewer.isGm
  const uiSet = useTableUi((s) => s.set)
  useEffect(() => {
    uiSet({ visible: darkness > 0 ? visibleDisplay : null })
    return () => uiSet({ visible: null })
  }, [visibleDisplay, darkness, uiSet])
  material.uniforms.uDark!.value = (gm ? 0.4 : 0.94) * darkness
  material.uniforms.uDim!.value = (gm ? 0.18 : 0.6) * darkness

  if (darkness <= 0) return null
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxZ - bounds.minZ
  return (
    <mesh
      position={[(bounds.minX + bounds.maxX) / 2, floorY + 0.03, (bounds.minZ + bounds.maxZ) / 2]}
      rotation-x={-Math.PI / 2}
      material={material}
      raycast={noRaycast}
      renderOrder={5}
    >
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}
