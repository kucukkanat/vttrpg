/**
 * Grid kits on the table. Mounted inside the <Canvas>.
 *
 * - Tiles: one BatchedMesh per 16×16 chunk (every level, every kit: they share one material), so
 *   a chunk is one draw call where the GPU has multi-draw. Only chunks whose record changed are
 *   rebuilt, at most `CHUNKS_PER_FRAME` a frame; whole chunks are frustum culled. The cutaway
 *   hides instances above the cut level without a rebuild.
 * - Doors: an invisible handle on every kit door (a swinging leaf on doorway frames) that opens and
 *   closes it like a drawn door: the GM always, players where the scene allows it and the door is
 *   in sight.
 * - The Kit tool (GM, `useKitUi.tool` while the build tool is `kit`): a plane at the build level
 *   catches the pointer; the cell, edge or vertex under it comes from plane maths and the
 *   occupancy, never mesh raycasts. Every tool shows a ghost of what it will write, and one stroke
 *   is one `tiles.place` intent (one undo step). R turns the piece, Esc puts the tool away.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCursor } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  BatchedMesh, BufferGeometry, Group, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Plane, Quaternion, Vector3,
} from 'three'
import { DOOR_OPEN, KIT_CELL, LEVEL_CELLS, parseCellKey, parseTile, type KitManifest, type KitPiece } from '@/core/kits'
import { cellsOfAreaPiece, isEdgeSlot, levelBase, pieceCentre, turnedFootprint, type EdgeAddr } from '@/core/kitGeometry'
import { BUILD } from '@/ui/theme/palette'
import { useGame } from '@/state/store'
import { useTable } from '../context'
import type { Bounds2 } from '../grid'
import { cellKey as gridCellKey, worldToCell } from '../grid'
import { FloorCatcher, floorPoint } from '../RulerLayer'
import { useTableUi } from '../tableState'
import { useBuildUi } from '../build/buildState'
import { edgesAlong, edgesAround, EMPTY_PLAN, planWalls, type TilePlan } from './autoJoin'
import { KIT_MATERIAL, kitPieceGeometry, useKitGeometryVersion } from './kitGeometry'
import { setKitTool, TOOL_SLOT, toolForSlot, useKitUi, type KitTool } from './kitState'
import type { KitDoor } from './kitWalls'
import { levelCellKey } from './levels'
import { pieceIndex, useKitManifests, type PieceLookup } from './manifests'
import type { Occupancy, Occupant } from './occupancy'
import { existingIn, normRect, planArea, planEdgePiece, planErase, planFloorRect, planRoofFill, planVertex, snapRect, snapToModule, type CellRect } from './paint'
import type { KitScene } from './useKitScene'

/** Chunk batches rebuilt per frame at most. */
export const CHUNKS_PER_FRAME = 2
const DRAG_THRESHOLD_PX = 6
const noRaycast = () => undefined

export function KitLayer({ kit, bounds }: { kit: KitScene; bounds: Bounds2 }) {
  const { viewer } = useTable()
  const gm = !viewer || viewer.isGm
  const buildTool = useBuildUi((s) => s.tool)
  const kitTool = useKitUi((s) => s.tool)
  const tableTool = useTableUi((s) => s.tool)
  const targeting = useTableUi((s) => s.targeting !== null)
  const active = gm && buildTool === 'kit' && kitTool && !tableTool && !targeting ? kitTool : null
  useLevelKeys(gm)
  useDevProbe()
  return (
    <>
      <KitTiles kit={kit} />
      <KitDoors kit={kit} />
      {active && <KitTool key={active} tool={active} kit={kit} bounds={bounds} />}
    </>
  )
}

/** Dev builds: `window.__kitDev.project(x, y, z)` gives the screen point of a world point, for scripted checks. */
function useDevProbe() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __kitDev?: unknown }
    w.__kitDev = {
      project: (x: number, y: number, z: number) => {
        const v = new Vector3(x, y, z).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      calls: () => gl.info.render.calls,
      /** World point on the plane y = `y` under a screen point. */
      unproject: (sx: number, sy: number, y = 0) => {
        const r = gl.domElement.getBoundingClientRect()
        const ndc = new Vector3(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1, 0.5)
        const dir = ndc.unproject(camera).sub(camera.position).normalize()
        const t = (y - camera.position.y) / dir.y
        return { x: camera.position.x + dir.x * t, z: camera.position.z + dir.z * t }
      },
      tiles: () => useGame.getState().tiles,
      visible: () => [...(useTableUi.getState().visible ?? [])],
      tokens: () => Object.values(useGame.getState().tokens).map((t) => ({ id: t.id, name: t.name, position: t.position, scene: t.scene })),
    }
    return () => { delete w.__kitDev }
  }, [camera, gl])
}

/** PgUp / PgDn: the level the GM builds on (and the cutaway, when it is set by hand). */
function useLevelKeys(gm: boolean) {
  useEffect(() => {
    if (!gm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      stepLevel(e.key === 'PageUp' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gm])
}

export function stepLevel(by: number): void {
  const s = useKitUi.getState()
  const level = Math.max(0, Math.min(31, s.level + by))
  s.set({ level, ...(s.cutaway !== null ? { cutaway: level } : {}) })
}

// ------------------------------------------------------------------ tiles

interface ChunkState {
  rec: Record<string, string>
  lookup: PieceLookup
  gridKey: string
  /** Some pieces were still loading when it was built. */
  missing: boolean
  version: number
  mesh: BatchedMesh | null
  /** Level of each instance id. */
  levels: number[]
}

const tmpQ = new Quaternion()
const tmpP = new Vector3()
const tmpS = new Vector3()
const UP = new Vector3(0, 1, 0)

interface Placed { geometry: BufferGeometry; matrix: Matrix4; level: number }

/** World matrix of a piece at a cell key. */
export function pieceMatrix(piece: KitPiece, at: { x: number; z: number }, level: number, rot: number, grid: { cellSize: number; origin: { x: number; z: number } }, floorY: number, out = new Matrix4()): Matrix4 {
  const [cx, cz] = pieceCentre(piece, at, rot)
  const s = grid.cellSize / KIT_CELL
  tmpP.set(grid.origin.x + grid.cellSize * cx, levelBase(level, floorY, grid.cellSize), grid.origin.z + grid.cellSize * cz)
  tmpQ.setFromAxisAngle(UP, (rot * Math.PI) / 2)
  tmpS.set(s, s, s)
  return out.compose(tmpP, tmpQ, tmpS)
}

/** The pieces of a set of cells, resolved and placed; `missing` when a geometry is still loading. */
function placeCells(cells: Iterable<[string, string]>, lookup: PieceLookup, grid: { cellSize: number; origin: { x: number; z: number } }, floorY: number, renderer?: import('three').WebGLRenderer): { placed: Placed[]; missing: boolean } {
  const placed: Placed[] = []
  let missing = false
  for (const [key, raw] of cells) {
    const c = parseCellKey(key)
    const t = parseTile(raw)
    const found = t ? lookup(t.kit, t.piece) : null
    if (!c || !t || !found) continue
    let piece = found.piece
    if (piece.openAs && (t.variant & DOOR_OPEN)) piece = found.manifest.pieces.find((p) => p.id === piece.openAs) ?? piece
    const geometry = kitPieceGeometry(found.manifest, piece, renderer)
    if (geometry === undefined) { missing = true; continue }
    if (!geometry) continue
    placed.push({ geometry, matrix: pieceMatrix(found.piece, c, c.level, t.rot, grid, floorY), level: c.level })
  }
  return { placed, missing }
}

/** One BatchedMesh for a set of placed pieces (null when empty). */
function batchOf(placed: Placed[], material = KIT_MATERIAL): { mesh: BatchedMesh; levels: number[] } | null {
  if (!placed.length) return null
  const unique = [...new Set(placed.map((p) => p.geometry))]
  let vertices = 0, indices = 0
  for (const g of unique) { vertices += g.getAttribute('position').count; indices += g.getIndex()?.count ?? 0 }
  const mesh = new BatchedMesh(placed.length, vertices, indices, material)
  const ids = new Map<BufferGeometry, number>()
  for (const g of unique) ids.set(g, mesh.addGeometry(g))
  const levels: number[] = []
  for (const p of placed) {
    const id = mesh.addInstance(ids.get(p.geometry)!)
    mesh.setMatrixAt(id, p.matrix)
    levels[id] = p.level
  }
  // Whole chunks are culled; per-piece culling would cost more CPU than it saves.
  mesh.perObjectFrustumCulled = false
  mesh.sortObjects = false
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  return { mesh, levels }
}

function applyCut(st: ChunkState, cut: number) {
  if (!st.mesh) return
  for (let i = 0; i < st.levels.length; i++) st.mesh.setVisibleAt(i, st.levels[i]! <= cut)
}

function KitTiles({ kit }: { kit: KitScene }) {
  const { grid, floorY, graphics } = useTable()
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const version = useKitGeometryVersion((s) => s.version)
  const group = useMemo(() => new Group(), [])
  const chunks = useRef(new Map<string, ChunkState>())
  const queue = useRef<string[]>([])
  const gridKey = `${grid.cellSize},${grid.origin.x},${grid.origin.z},${floorY}`
  const cutRef = useRef(kit.cut)
  cutRef.current = kit.cut
  const shadows = !!graphics.shadows

  useEffect(() => {
    const recs = kit.tiles?.chunks ?? {}
    for (const [id, st] of chunks.current) {
      if (recs[id]) continue
      if (st.mesh) { group.remove(st.mesh); st.mesh.dispose() }
      chunks.current.delete(id)
    }
    for (const id in recs) {
      const st = chunks.current.get(id)
      const stale = !st || st.rec !== recs[id] || st.lookup !== kit.lookup || st.gridKey !== gridKey || (st.missing && st.version !== version)
      if (stale && !queue.current.includes(id)) queue.current.push(id)
    }
    if (queue.current.length) invalidate()
  }, [kit.tiles, kit.lookup, gridKey, version, group, invalidate])

  useFrame(() => {
    let n = 0
    while (queue.current.length && n < CHUNKS_PER_FRAME) {
      const id = queue.current.shift()!
      const rec = kit.tiles?.chunks[id]
      if (!rec) continue
      n++
      const { placed, missing } = placeCells(Object.entries(rec), kit.lookup, grid, floorY, gl)
      const built = batchOf(placed)
      const old = chunks.current.get(id)
      if (old?.mesh) { group.remove(old.mesh); old.mesh.dispose() }
      const st: ChunkState = { rec, lookup: kit.lookup, gridKey, missing, version, mesh: built?.mesh ?? null, levels: built?.levels ?? [] }
      if (st.mesh) {
        st.mesh.castShadow = shadows
        st.mesh.receiveShadow = shadows
        st.mesh.name = `kit-chunk ${id}`
        st.mesh.raycast = noRaycast
        applyCut(st, cutRef.current)
        group.add(st.mesh)
      }
      chunks.current.set(id, st)
    }
    if (n) invalidate()
  })

  useEffect(() => {
    for (const st of chunks.current.values()) applyCut(st, kit.cut)
    invalidate()
  }, [kit.cut, invalidate])

  useEffect(() => () => {
    for (const st of chunks.current.values()) if (st.mesh) st.mesh.dispose()
    chunks.current.clear()
  }, [])

  return <primitive object={group} />
}

// ------------------------------------------------------------------ doors

function KitDoors({ kit }: { kit: KitScene }) {
  const { sceneId, scene, viewer, grid, onIntent } = useTable()
  const visible = useTableUi((s) => s.visible)
  const gm = !viewer || viewer.isGm
  const doors = useMemo(() => {
    const out: KitDoor[] = []
    for (const level of kit.levels) if (level <= kit.cut) out.push(...kit.wallsAt(level).doors)
    return out
  }, [kit])
  if (!doors.length) return null
  const inSight = (d: KitDoor) => {
    if (gm || !visible) return true
    const mx = (d.a.x + d.b.x) / 2, mz = (d.a.z + d.b.z) / 2
    const dx = d.b.x - d.a.x, dz = d.b.z - d.a.z
    const len = Math.hypot(dx, dz) || 1
    const off = grid.cellSize * 0.3
    const nx = (-dz / len) * off, nz = (dx / len) * off
    return [worldToCell(grid, mx + nx, mz + nz), worldToCell(grid, mx - nx, mz - nz)].some((c) => visible.has(levelCellKey(gridCellKey(c), d.level)))
  }
  return (
    <group>
      {doors.map((d) => {
        const canUse = !viewer?.display && (gm || (!!scene.playersOpenDoors && inSight(d)))
        return <KitDoorHandle key={d.key} door={d} canUse={canUse} onToggle={() => onIntent({ type: 'tiles.door', scene: sceneId, key: d.key, open: !d.open })} />
      })}
    </group>
  )
}

const leafMaterial = new MeshLambertMaterial({ color: '#6b4a2b' })
const leafHover = new MeshLambertMaterial({ color: '#a0764a' })
const handleMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

function KitDoorHandle({ door, canUse, onToggle }: { door: KitDoor; canUse: boolean; onToggle(): void }) {
  const { grid, floorY } = useTable()
  const [hover, setHover] = useState(false)
  useCursor(hover && canUse, 'pointer')
  const dx = door.b.x - door.a.x, dz = door.b.z - door.a.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return null
  const angle = -Math.atan2(dz, dx)
  const h = 0.72 * LEVEL_CELLS * grid.cellSize
  const t = 0.08 * grid.cellSize
  const swing = door.open ? -Math.PI * 0.45 : 0
  const y = levelBase(door.level, floorY, grid.cellSize)
  const handlers = canUse ? {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true) },
    onPointerOut: () => setHover(false),
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onToggle() },
  } : { raycast: noRaycast }
  return (
    <group position={[door.a.x, y, door.a.z]} rotation-y={angle + (door.leaf ? swing : 0)}>
      <mesh position={[len / 2, h / 2, 0]} castShadow={door.leaf} material={door.leaf ? (hover && canUse ? leafHover : leafMaterial) : handleMaterial} {...handlers}>
        <boxGeometry args={[len, h, door.leaf ? t : t * 4]} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ the tool

interface Hover {
  /** Point on the level plane, world. */
  x: number
  z: number
  /** Same, in cell units (cell centres on integers). */
  fx: number
  fz: number
}

const cellAt = (h: Hover) => ({ x: Math.round(h.fx), z: Math.round(h.fz) })
const vertexAt = (h: Hover) => ({ x: Math.round(h.fx + 0.5), z: Math.round(h.fz + 0.5) })

/** The cell edge nearest a point, and how far it is (cells). */
export function edgeAt(fx: number, fz: number): { edge: EdgeAddr; dist: number } {
  const lineZ = Math.round(fz + 0.5) - 0.5
  const lineX = Math.round(fx + 0.5) - 0.5
  const dz = Math.abs(fz - lineZ), dx = Math.abs(fx - lineX)
  return dz <= dx
    ? { edge: { x: Math.round(fx), z: Math.round(fz + 0.5), side: 'n' }, dist: dz }
    : { edge: { x: Math.round(fx + 0.5), z: Math.round(fz), side: 'w' }, dist: dx }
}

/** The piece under a point on a level: a wall near an edge, a vertex piece near a vertex, else roof, stair, floor. */
export function pickAt(occ: Occupancy, level: number, fx: number, fz: number): Occupant | undefined {
  const v = { x: Math.round(fx + 0.5), z: Math.round(fz + 0.5) }
  if (Math.hypot(fx - (v.x - 0.5), fz - (v.z - 0.5)) < 0.3) { const o = occ.vertex(level, v.x, v.z); if (o) return o }
  const { edge, dist } = edgeAt(fx, fz)
  if (dist < 0.3) { const o = occ.edge(level, edge); if (o) return o }
  const c = { x: Math.round(fx), z: Math.round(fz) }
  return occ.cell(level, c.x, c.z, 's') ?? occ.cell(level, c.x, c.z, 'f') ?? occ.cell(level + 1, c.x, c.z, 'r')
}

/** The kit's piece for a slot: picked in the palette, else the kit's default. */
function pieceFor(m: KitManifest, tool: KitTool, picked: Partial<Record<string, string>>): KitPiece | undefined {
  const slot = TOOL_SLOT[tool]
  if (!slot) return undefined
  const d = m.defaults
  const fallback = slot === 'floor' ? d.floor : slot === 'door' ? d.door : slot === 'window' ? d.window : slot === 'stair' ? d.stair
    : slot === 'roof' ? (d.roof ?? d.roofGable) : slot === 'pillar' ? d.pillar : undefined
  const id = picked[slot] && m.pieces.some((p) => p.id === picked[slot]) ? picked[slot] : fallback
  return m.pieces.find((p) => p.id === id)
}

interface Stroke { pointerId: number; startX: number; startY: number; moved: boolean; from: Hover }

function KitTool({ tool, kit, bounds }: { tool: KitTool; kit: KitScene; bounds: Bounds2 }) {
  const { grid, floorY, sceneId, onIntent } = useTable()
  const manifests = useKitManifests((s) => s.manifests)
  const kitId = useKitUi((s) => s.kit)
  const level = useKitUi((s) => s.level)
  const rot = useKitUi((s) => s.rot)
  const picked = useKitUi((s) => s.pieces)
  const wallPiece = useKitUi((s) => s.wallPiece)
  const outlineOn = useKitUi((s) => s.outline)
  const manifest = manifests[kitId]
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const uiSet = useTableUi((s) => s.set)
  const levelY = levelBase(level, floorY, grid.cellSize)
  const scratch = useMemo(() => ({ plane: new Plane(new Vector3(0, 1, 0), -levelY), hit: new Vector3() }), [levelY])
  const [hover, setHover] = useState<Hover | null>(null)
  const [drag, setDrag] = useState<{ from: Hover; to: Hover } | null>(null)
  const stroke = useRef<Stroke | null>(null)
  const shift = useRef(false)

  // R / Shift+R turn the piece in hand; Esc puts the tool away; Shift draws room outlines.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shift.current = e.type === 'keydown'
      if (e.type !== 'keydown') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'Escape') { setKitTool(null); return }
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const s = useKitUi.getState()
        s.set({ rot: (s.rot + (e.shiftKey ? 3 : 1)) % 4 })
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true) }
  }, [])
  useEffect(() => () => {
    if (stroke.current) { stroke.current = null; useTableUi.getState().set({ editDrag: false }); if (controls) controls.enabled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toHover = (e: ThreeEvent<PointerEvent>): Hover | null => {
    const p = floorPoint(e, levelY, scratch)
    if (!p) return null
    return { x: p.x, z: p.z, fx: (p.x - grid.origin.x) / grid.cellSize, fz: (p.z - grid.origin.z) / grid.cellSize }
  }
  const floorAt = (x: number, z: number) => !!kit.occ.cell(level, x, z, 'f')

  /** What the tool would write for the current hover and drag. */
  const plan = useMemo((): { plan: TilePlan; outline?: CellRect } => {
    if (!manifest || !hover) return { plan: EMPTY_PLAN }
    const occ = kit.occ
    const piece = pieceFor(manifest, tool, picked)
    const module = manifest.module
    switch (tool) {
      case 'floor': {
        if (!piece) return { plan: EMPTY_PLAN }
        const big = Math.max(...piece.footprint) > 1 ? module : 1
        const r = drag ? snapRect(normRect(cellAt(drag.from), cellAt(drag.to)), big) : null
        if (r) return { plan: planFloorRect(occ, level, manifest, piece, r, rot), outline: r }
        return { plan: planArea(occ, level, manifest, piece, centredAnchor(piece, cellAt(hover), rot), rot) }
      }
      case 'wall': {
        if (wallPiece) {
          const p = manifest.pieces.find((x) => x.id === wallPiece)
          return { plan: p ? planEdgePiece(occ, level, manifest, p, edgeAt(hover.fx, hover.fz).edge, rot, floorAt) : EMPTY_PLAN }
        }
        const snapV = (v: { x: number; z: number }) => ({ x: snapToModule(v.x, module), z: snapToModule(v.z, module) })
        const a = snapV(vertexAt(drag?.from ?? hover))
        const b = snapV(vertexAt(drag?.to ?? hover))
        if (!drag) return { plan: EMPTY_PLAN }
        const edges = outlineOn || shift.current ? edgesAround(a, b) : edgesAlong(a, b)
        return { plan: planWalls({ occ, level, manifest, add: edges, floorAt }) }
      }
      case 'door': case 'window':
        return { plan: piece ? planEdgePiece(occ, level, manifest, piece, edgeAt(hover.fx, hover.fz).edge, undefined, floorAt) : EMPTY_PLAN }
      case 'stair':
        return { plan: piece ? planArea(occ, level, manifest, piece, centredAnchor(piece, cellAt(hover), rot), rot) : EMPTY_PLAN }
      case 'roof': {
        if (drag) {
          const r = normRect(cellAt(drag.from), cellAt(drag.to))
          return { plan: planRoofFill(occ, level, manifest, r), outline: snapRect(r, piece ? module : 1) }
        }
        if (!piece) return { plan: EMPTY_PLAN }
        const c = cellAt(hover)
        const at = module > 1 ? { x: Math.floor(c.x / module) * module, z: Math.floor(c.z / module) * module } : centredAnchor(piece, c, rot)
        return { plan: planArea(occ, level + 1, manifest, piece, at, rot) }
      }
      case 'pillar': {
        const p = piece ?? manifest.pieces.find((x) => x.id === picked.corner)
        return { plan: p ? planVertex(occ, level, manifest, p, vertexAt(hover), rot) : EMPTY_PLAN }
      }
      case 'erase': {
        if (drag) {
          const r = normRect(cellAt(drag.from), cellAt(drag.to))
          return { plan: planErase({ occ, level, manifest, rect: r }), outline: r }
        }
        const o = pickAt(occ, level, hover.fx, hover.fz)
        return { plan: o ? planErase({ occ, level, manifest, piece: o }) : EMPTY_PLAN }
      }
      default:
        return { plan: EMPTY_PLAN }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, hover, drag, tool, rot, picked, wallPiece, outlineOn, kit.occ, level])

  const begin = (e: ThreeEvent<PointerEvent>, h: Hover) => {
    try { (e.target as unknown as { setPointerCapture(id: number): void }).setPointerCapture(e.pointerId) } catch { /* Safari */ }
    if (controls) controls.enabled = false
    uiSet({ editDrag: true, hovered: null, grab: null })
    stroke.current = { pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false, from: h }
  }
  const end = () => {
    stroke.current = null
    uiSet({ editDrag: false })
    if (controls) controls.enabled = true
  }
  const commit = (p: TilePlan) => {
    if (!p.keys.length) return
    onIntent({ type: 'tiles.place', scene: sceneId, kits: p.kits, keys: p.keys, values: p.values })
  }
  const dragTools = tool === 'floor' || tool === 'wall' || tool === 'roof' || tool === 'erase'

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || stroke.current) return
    e.stopPropagation()
    const h = toHover(e)
    if (!h) return
    setHover(h)
    begin(e, h)
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const h = toHover(e)
    const s = stroke.current
    if (!s) { if (h) setHover(h); return }
    if (e.pointerId !== s.pointerId) return
    e.stopPropagation()
    if (!s.moved && Math.hypot(e.nativeEvent.clientX - s.startX, e.nativeEvent.clientY - s.startY) >= DRAG_THRESHOLD_PX) s.moved = true
    if (!h) return
    setHover(h)
    if (s.moved && dragTools) setDrag({ from: s.from, to: h })
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const s = stroke.current
    if (!s || e.pointerId !== s.pointerId) return
    e.stopPropagation()
    try { (e.target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture(s.pointerId) } catch { /* ditto */ }
    end()
    if (tool === 'pick') {
      const h = toHover(e) ?? s.from
      const o = pickAt(kit.occ, level, h.fx, h.fz)
      if (o) takeInHand(o)
      return
    }
    // A tap with a drag tool still places (one floor tile, one erase); a wall needs a drag.
    if (tool === 'wall' && !wallPiece && !s.moved) { setDrag(null); return }
    commit(plan.plan)
    setDrag(null)
  }

  if (!manifest) return null
  const y = levelY + 0.05
  const hv = hover ? (tool === 'pillar' || tool === 'wall' ? vertexAt(hover) : null) : null
  return (
    <group>
      <FloorCatcher bounds={bounds} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { end(); setDrag(null) }} />
      <PlanGhost plan={plan.plan} kit={kit} />
      {plan.outline && <RectMarker rect={plan.outline} y={y} color={tool === 'erase' ? BUILD.erase : BUILD.pen} />}
      {hv && !drag && (
        <mesh rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={21}
          position={[grid.origin.x + grid.cellSize * (hv.x - 0.5), y, grid.origin.z + grid.cellSize * (hv.z - 0.5)]}>
          <circleGeometry args={[0.12 * grid.cellSize, 20]} />
          <meshBasicMaterial color={BUILD.pen} transparent opacity={0.85} depthTest={false} />
        </mesh>
      )}
    </group>
  )
}

/** The anchor that centres a piece's footprint on a cell. */
function centredAnchor(piece: KitPiece, cell: { x: number; z: number }, rot: number): { x: number; z: number } {
  const [w, d] = turnedFootprint(piece, rot)
  return { x: cell.x - Math.floor((Math.max(1, w) - 1) / 2), z: cell.z - Math.floor((Math.max(1, d) - 1) / 2) }
}

/** Eyedropper: the clicked piece's kit, piece and turn go in hand with its tool. */
export function takeInHand(o: Occupant): void {
  const slot = o.piece.slot
  const s = useKitUi.getState()
  const d = o.manifest.defaults
  const plainWall = [d.wall, d.half, d.corner, d.tee, d.cross].includes(o.piece.id)
  const tool = toolForSlot(slot === 'corner' && plainWall ? 'wall' : slot)
  s.set({
    kit: o.manifest.id,
    rot: o.value.rot,
    pieces: { ...s.pieces, [slot]: o.piece.id },
    wallPiece: slot === 'wall' && !plainWall ? o.piece.id : null,
  })
  setKitTool(null)
  setKitTool(tool)
}

const ghostAdd = new MeshLambertMaterial({ color: '#9fd3ff', transparent: true, opacity: 0.55, depthWrite: false })
const ghostRemove = new MeshBasicMaterial({ color: BUILD.erase, transparent: true, opacity: 0.45, depthWrite: false })

/** Translucent pieces for what a plan writes, red ones for what it clears. */
function PlanGhost({ plan, kit }: { plan: TilePlan; kit: KitScene }) {
  const { grid, floorY } = useTable()
  const gl = useThree((s) => s.gl)
  const manifests = useKitManifests((s) => s.manifests)
  const version = useKitGeometryVersion((s) => s.version)
  const meshes = useMemo(() => {
    void version
    const adds: [string, string][] = []
    const removes: Placed[] = []
    const existing = existingIn(kit.occ)
    plan.keys.forEach((key, i) => {
      const v = plan.values[i]!
      if (v === '') {
        const o = existing(key)
        if (!o) return
        const g = kitPieceGeometry(o.manifest, o.piece, gl)
        if (g) removes.push({ geometry: g, matrix: pieceMatrix(o.piece, o.at, o.level, o.value.rot, grid, floorY), level: o.level })
        return
      }
      adds.push([key, v])
    })
    // Plan values index the plan's own kit list.
    const lookup: PieceLookup = (k, p) => {
      const m = manifests[plan.kits[k] ?? '']
      const piece = m?.pieces[p]
      return m && piece ? { manifest: m, piece } : null
    }
    const placed = placeCells(adds, lookup, grid, floorY, gl).placed
    const lift = new Matrix4().makeTranslation(0, 0.01, 0)
    for (const p of placed) p.matrix.premultiply(lift)
    return [batchOf(placed, ghostAdd)?.mesh, batchOf(removes, ghostRemove)?.mesh].filter((m): m is BatchedMesh => !!m)
  }, [plan, kit.occ, manifests, version, grid, floorY, gl])
  useEffect(() => () => { for (const m of meshes) m.dispose() }, [meshes])
  return <>{meshes.map((m) => <primitive key={m.uuid} object={m} raycast={noRaycast} renderOrder={15} />)}</>
}

function RectMarker({ rect, y, color }: { rect: CellRect; y: number; color: string }) {
  const { grid } = useTable()
  const x0 = grid.origin.x + grid.cellSize * (rect.x0 - 0.5), x1 = grid.origin.x + grid.cellSize * (rect.x1 + 0.5)
  const z0 = grid.origin.z + grid.cellSize * (rect.z0 - 0.5), z1 = grid.origin.z + grid.cellSize * (rect.z1 + 0.5)
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, y, (z0 + z1) / 2]} raycast={noRaycast} renderOrder={20}>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
      <meshBasicMaterial color={color} transparent opacity={0.18} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

/** Piece index of a piece id in its kit (for the palette). */
export function indexOf(m: KitManifest, piece: KitPiece): number {
  return pieceIndex(m, piece.id)
}

/** Cells an area piece would cover (for the palette's footprint badge). */
export const footprintCells = (p: KitPiece) => (isEdgeSlot(p.slot) ? Math.round(p.footprint[0]) : cellsOfAreaPiece(p, { x: 0, z: 0 }, 0).length)
