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
import { revealsFor, seesThrough, useTable } from './context'
import { useTableUi } from './tableState'
import { ALL_CELLS, computeVisibleCells, exploredCells, fogRasterLayout, fogStrength, isFogEnabled, rasterizeFog, type CellSet, type Viewer2D } from './vision'
import type { WallSegment } from './walls'
import { levelBase } from '@/core/kits'
import { levelCellKey, levelView, tokenLevel } from './kits/levels'
import { sightWallsAt, type KitScene } from './kits/useKitScene'
import type { GridSpec } from '@/core/geometry'

type LevelViewer = Viewer2D & { level: number }

/**
 * Cells visible to viewers on several levels: each level's viewers see past the walls of that
 * level only, and their cells carry the level in the key (`levelCellKey`; level 0 keeps the plain
 * keys of single-level scenes).
 */
export function visibleByLevel(grid: GridSpec, viewers: readonly LevelViewer[], walls: readonly WallSegment[], kits: KitScene | undefined): Set<string> {
  const byLevel = new Map<number, Viewer2D[]>()
  for (const v of viewers) {
    let list = byLevel.get(v.level)
    if (!list) byLevel.set(v.level, (list = []))
    list.push(v)
  }
  if (byLevel.size === 1 && byLevel.has(0) && !kits?.wallsAt(0).sight.length) return computeVisibleCells(grid, viewers, walls)
  const out = new Set<string>()
  for (const [level, list] of byLevel) {
    for (const k of computeVisibleCells(grid, list, sightWallsAt(kits, level, walls))) out.add(levelCellKey(k, level))
  }
  return out
}

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

/**
 * `brightFloor`: the floor is a map image, which reads much lighter than a 3D room, so unexplored
 * and explored-but-unseen cells are darkened a little more for revealed cells to stand out.
 */
export function FogOverlay({ bounds, walls, brightFloor = false }: { bounds: Bounds2; walls: readonly WallSegment[]; brightFloor?: boolean }) {
  const { grid, floorY, viewer, sceneId, scene, onIntent, kits } = useTable()
  const tokens = useGame((s) => s.tokens)
  const fog = useGame((s) => s.fog[sceneId])
  const drag = useTableUi((s) => s.drag)

  const sceneTokens = useMemo(
    () => Object.values(tokens).filter((t) => t.scene === sceneId && !t.hidden),
    [tokens, sceneId],
  )
  const position = (t: Token): LevelViewer => {
    const level = tokenLevel(t.position.y, floorY, grid)
    return drag && drag.token === t.id
      ? { x: drag.x, z: drag.z, vision: t.vision, level }
      : { x: t.position.x, z: t.position.z, vision: t.vision, level }
  }

  // Cells seen by tokens whose sight this client is responsible for revealing.
  const revealTokens = useMemo(() => sceneTokens.filter((t) => revealsFor(viewer, t)), [sceneTokens, viewer])
  const visibleReveal = useMemo(
    () => visibleByLevel(grid, revealTokens.map(position), walls, kits),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, revealTokens, walls, drag, kits],
  )
  // What this viewer sees: GM sees through every token, a table display through every player's,
  // players only through their own (see `seesThrough`).
  const visibleDisplay = useMemo(() => {
    const others = sceneTokens.filter((t) => seesThrough(viewer, t) && !revealsFor(viewer, t))
    if (others.length === 0) return visibleReveal
    const out = new Set(visibleReveal)
    for (const k of visibleByLevel(grid, others.map(position), walls, kits)) out.add(k)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, sceneTokens, viewer, visibleReveal, walls, drag, kits])

  const explored = useMemo(() => exploredCells(fog), [fog])
  const viewLevel = kits?.viewLevel ?? 0
  const fogOn = isFogEnabled(scene)

  // Optimistically remember what we already asked to reveal, so we do not re-send every render.
  const pending = useRef<{ scene: string; cells: Set<string>; explored: number }>({ scene: sceneId, cells: new Set(), explored: 0 })
  useEffect(() => {
    if (pending.current.scene !== sceneId) pending.current = { scene: sceneId, cells: new Set(), explored: 0 }
    // The explored set shrank (fog reset): forget what was sent so the cells in sight go out again.
    const count = fog?.revealed.length ?? 0
    if (count < pending.current.explored) pending.current.cells.clear()
    pending.current.explored = count
    if (drag || !fogOn || explored === ALL_CELLS) return // wait for the drop; the committed position decides what was revealed
    const fresh: string[] = []
    for (const k of visibleReveal) {
      if (explored.has(k) || pending.current.cells.has(k)) continue
      pending.current.cells.add(k)
      fresh.push(k)
    }
    if (fresh.length) onIntent({ type: 'fog.reveal', scene: sceneId, cells: fresh })
  }, [visibleReveal, explored, fog, fogOn, sceneId, drag, onIntent])

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
    let all: CellSet = explored
    if (explored instanceof Set) {
      const merged = new Set(explored)
      for (const k of pending.current.cells) merged.add(k)
      all = merged
    }
    // The fog drawn is the one of the level on view (the cutaway's); level 0 for single-level scenes.
    rasterizeFog(grid, layout, levelView(visibleDisplay, viewLevel), levelView(all, viewLevel), texture.image.data as Uint8Array)
    texture.needsUpdate = true
  }, [grid, layout, visibleDisplay, explored, texture, viewLevel])

  const strength = fogStrength(scene)
  const fogY = levelBase(viewLevel, floorY, grid.cellSize)
  const gm = !viewer || viewer.isGm
  const uiSet = useTableUi((s) => s.set)
  useEffect(() => {
    uiSet({ visible: fogOn ? visibleDisplay : null })
    return () => uiSet({ visible: null })
  }, [visibleDisplay, fogOn, uiSet])
  material.uniforms.uDark!.value = (gm ? (brightFloor ? 0.6 : 0.4) : (brightFloor ? 0.97 : 0.94)) * strength
  material.uniforms.uDim!.value = (gm ? (brightFloor ? 0.3 : 0.18) : (brightFloor ? 0.72 : 0.6)) * strength

  if (!fogOn) return null
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxZ - bounds.minZ
  return (
    <mesh
      position={[(bounds.minX + bounds.maxX) / 2, fogY + 0.03, (bounds.minZ + bounds.maxZ) / 2]}
      rotation-x={-Math.PI / 2}
      material={material}
      raycast={noRaycast}
      renderOrder={5}
    >
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}
