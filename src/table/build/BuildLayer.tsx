/**
 * The GM's build tools on the table, plus what everyone sees of them. Mounted inside the <Canvas>.
 *
 * - Doors: a wooden slab on every door (swung open when open). A tap opens or closes it (GM always,
 *   players where the scene allows it, never a locked one); a right-click locks it (GM).
 * - Placed lights: point lights on the floor plan; the GM also sees a small bulb.
 * - Walls overlay (GM): drawn walls, doors, imported/model walls and detection proposals as lines
 *   while a build tool is active, a proposal is under review or "Show walls" is on.
 * - The active build tool (`buildState.tool`): a floor catcher that owns the pointer, like the
 *   ruler, for drawing walls and doors, erasing, the fog brush, placing lights and capturing and
 *   stamping prefabs. Esc puts the tool away; R turns a stamp. Holding a library model (and the
 *   eyedropper, Alt-click, card drops) is `PlaceLayer`.
 * - Shared views: "pull everyone to my view", a display following the GM, the GM sharing their camera.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Line, useCursor } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import type { PlacedLight, Wall } from '@/core/doc'
import { newId, type LightId, type SceneId, type WallId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from '../context'
import { cellKey, cellsWithinRadius, snapToCell, worldToCell, type Bounds2 } from '../grid'
import { FloorCatcher, floorPoint } from '../RulerLayer'
import { requestView, tableRuntime, useTableUi } from '../tableState'
import { CAMERA_SHARE_INTERVAL_MS, followedCamera, makeView, takePull, viewMoved } from '../view'
import { exploredCells } from '../vision'
import type { Pt2, WallSegment } from '../walls'
import { useBuildUi, type BuildTool } from './buildState'
import { AltEyedropper, CardDrop, PlaceLayer } from './PlaceLayer'
import { capturePrefab, snapRectToCells, stampCorner, stampPrefab, stampSize } from './prefab'
import { blockingSegments, cleanPoint, endpointsOf, isDrawable, pointSegmentDistance, sceneWalls, segmentsNear, snapWallPoint, wallsNear } from './wallEdit'
import { BUILD } from '@/ui/theme/palette'

const noRaycast = () => undefined
const DRAG_THRESHOLD_PX = 6
/** How often a fog brush stroke sends what it has painted so far. */
const BRUSH_SEND_MS = 200

const COLORS = BUILD

/** The drawn walls of a scene, stable across document syncs that did not touch them. */
export function useSceneWalls(sceneId: SceneId): Wall[] {
  const all = useGame((s) => s.walls)
  const last = useRef<{ key: string; walls: Wall[] }>({ key: '', walls: [] })
  return useMemo(() => {
    const walls = sceneWalls(all, sceneId)
    const key = JSON.stringify(walls)
    if (key !== last.current.key) last.current = { key, walls }
    return last.current.walls
  }, [all, sceneId])
}

/** Blocking segments of the scene's drawn walls and closed doors, stable while they do not change. */
export function useDrawnBlocking(sceneId: SceneId): WallSegment[] {
  const walls = useSceneWalls(sceneId)
  return useMemo(() => blockingSegments(walls), [walls])
}

function useSceneLights(sceneId: SceneId): PlacedLight[] {
  const all = useGame((s) => s.lights)
  const last = useRef<{ key: string; lights: PlacedLight[] }>({ key: '', lights: [] })
  return useMemo(() => {
    const lights = Object.values(all).filter((l) => l.scene === sceneId)
    const key = JSON.stringify(lights)
    if (key !== last.current.key) last.current = { key, lights }
    return last.current.lights
  }, [all, sceneId])
}

export function BuildLayer({ bounds, baseWalls }: { bounds: Bounds2; baseWalls: readonly WallSegment[] }) {
  const { viewer } = useTable()
  const gm = !viewer || viewer.isGm
  const tool = useBuildUi((s) => s.tool)
  const showWalls = useBuildUi((s) => s.showWalls)
  const proposal = useBuildUi((s) => s.proposal)
  const tableTool = useTableUi((s) => s.tool)
  const targeting = useTableUi((s) => s.targeting !== null)

  // The HUD's ruler / ping and the build tools exclude each other: the one picked last wins.
  const prevTableTool = useRef(tableTool)
  useEffect(() => {
    if (tableTool && tableTool !== prevTableTool.current && useBuildUi.getState().tool) useBuildUi.getState().set({ tool: null })
    prevTableTool.current = tableTool
  }, [tableTool])
  useEffect(() => { if (tool && useTableUi.getState().tool) useTableUi.getState().set({ tool: null }) }, [tool])
  // Leaving the table (scene switch, unmount) puts the tool away.
  useEffect(() => () => useBuildUi.getState().set({ tool: null }), [])

  const active = gm && tool && !tableTool && !targeting ? tool : null
  return (
    <>
      <Doors />
      <Lights />
      {gm && (active || showWalls || proposal) && <WallsOverlay baseWalls={baseWalls} />}
      {active && (active === 'place' || active === 'eyedropper'
        ? <PlaceLayer tool={active} bounds={bounds} />
        : <ToolCatcher key={active} tool={active} bounds={bounds} baseWalls={baseWalls} />)}
      {gm && !viewer?.display && <AltEyedropper />}
      {gm && !viewer?.display && <CardDrop />}
      <ViewSync />
    </>
  )
}

// ------------------------------------------------------------------ doors

function Doors() {
  const { sceneId, scene, viewer, grid, floorY, onIntent } = useTable()
  const walls = useSceneWalls(sceneId)
  const doors = useMemo(() => walls.filter((w) => w.door), [walls])
  const visible = useTableUi((s) => s.visible)
  const fog = useGame((s) => s.fog[sceneId])
  const explored = useMemo(() => exploredCells(fog), [fog])
  const gm = !viewer || viewer.isGm
  if (!doors.length) return null
  // Players see a door once either side of it has been seen; they work it while a side is in sight.
  const sides = (w: Wall): string[] => {
    const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z
    const len = Math.hypot(dx, dz) || 1
    const off = grid.cellSize * 0.3
    const nx = (-dz / len) * off, nz = (dx / len) * off
    return [cellKey(worldToCell(grid, mx + nx, mz + nz)), cellKey(worldToCell(grid, mx - nx, mz - nz))]
  }
  return (
    <group>
      {doors.map((w) => {
        const keys = sides(w)
        const seen = gm || !visible || keys.some((k) => visible.has(k) || explored.has(k))
        if (!seen) return null
        const inSight = gm || !visible || keys.some((k) => visible.has(k))
        const canUse = !viewer?.display && (gm || (!!scene.playersOpenDoors && !w.door!.locked && inSight))
        return (
          <DoorMesh key={w.id} wall={w} cellSize={grid.cellSize} floorY={floorY} gm={gm} canUse={canUse}
            onToggle={() => onIntent({ type: 'door.set', wall: w.id, open: !w.door!.open })}
            onLock={() => onIntent({ type: 'wall.update', wall: w.id, patch: { door: { open: w.door!.open, locked: !w.door!.locked } } })} />
        )
      })}
    </group>
  )
}

function DoorMesh({ wall, cellSize, floorY, gm, canUse, onToggle, onLock }: {
  wall: Wall; cellSize: number; floorY: number; gm: boolean; canUse: boolean; onToggle(): void; onLock(): void
}) {
  const [hover, setHover] = useState(false)
  useCursor(hover && canUse, 'pointer')
  const dx = wall.b.x - wall.a.x, dz = wall.b.z - wall.a.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return null
  const open = !!wall.door?.open
  const locked = !!wall.door?.locked
  const angle = -Math.atan2(dz, dx)
  const h = 0.9 * cellSize
  const t = 0.08 * cellSize
  // Hinged at `a`; open swings it most of the way round so the gap reads from above.
  const swing = open ? -Math.PI * 0.45 : 0
  const color = hover && canUse ? '#a0764a' : locked && gm ? '#5c2a2a' : '#6b4a2b'
  return (
    <group position={[wall.a.x, floorY, wall.a.z]} rotation-y={angle + swing}>
      <mesh
        position={[len / 2, h / 2, 0]}
        castShadow
        receiveShadow
        {...(canUse || gm ? {} : { raycast: noRaycast })}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => { if (!canUse) return; e.stopPropagation(); onToggle() }}
        onContextMenu={(e) => { e.stopPropagation(); e.nativeEvent.preventDefault(); if (gm) onLock() }}
      >
        <boxGeometry args={[len, h, t]} />
        <meshStandardMaterial color={color} roughness={0.85} transparent={open} opacity={open ? 0.75 : 1} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ lights

function Lights() {
  const { sceneId, viewer, grid, floorY } = useTable()
  const lights = useSceneLights(sceneId)
  const gm = !viewer || viewer.isGm
  const tool = useBuildUi((s) => s.tool)
  const cell = grid.cellSize
  return (
    <group>
      {lights.map((l) => (
        <group key={l.id} position={[l.position.x, floorY + 1.4 * cell, l.position.z]}>
          <pointLight color={l.color} distance={l.radius * cell * 1.6} decay={2} intensity={5 * cell * cell * (l.intensity ?? 1) * Math.max(1, l.radius / 3)} />
          {gm && (tool === 'light' || tool === 'erase') && (
            <mesh raycast={noRaycast}>
              <sphereGeometry args={[0.12 * cell, 12, 8]} />
              <meshBasicMaterial color={l.color} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ walls overlay

type P3 = [number, number, number]

/** Segment pairs for a drei <Line segments>. */
function segmentPoints(segments: readonly WallSegment[], y: number): P3[] {
  const out: P3[] = []
  for (const s of segments) out.push([s.a.x, y, s.a.z], [s.b.x, y, s.b.z])
  return out
}

function Lines({ segments, color, y, width = 3, dashed = false }: { segments: readonly WallSegment[]; color: string; y: number; width?: number; dashed?: boolean }) {
  const points = useMemo(() => segmentPoints(segments, y), [segments, y])
  if (points.length < 2) return null
  return (
    <Line points={points} segments color={color} lineWidth={width} dashed={dashed} dashSize={0.25} gapSize={0.15}
      depthTest={false} transparent opacity={0.95} renderOrder={20} raycast={noRaycast} />
  )
}

function WallsOverlay({ baseWalls }: { baseWalls: readonly WallSegment[] }) {
  const { sceneId, floorY } = useTable()
  const walls = useSceneWalls(sceneId)
  const proposal = useBuildUi((s) => (s.proposal?.scene === sceneId ? s.proposal : null))
  const groups = useMemo(() => {
    const plain: WallSegment[] = [], closed: WallSegment[] = [], open: WallSegment[] = [], locked: WallSegment[] = []
    for (const w of walls) {
      if (!w.door) plain.push(w)
      else if (w.door.locked) locked.push(w)
      else if (w.door.open) open.push(w)
      else closed.push(w)
    }
    return { plain, closed, open, locked }
  }, [walls])
  const y = floorY + 0.06
  return (
    <group>
      <Lines segments={baseWalls} color={COLORS.base} y={y} width={2} />
      <Lines segments={groups.plain} color={COLORS.wall} y={y} />
      <Lines segments={groups.closed} color={COLORS.door} y={y} width={4} />
      <Lines segments={groups.open} color={COLORS.doorOpen} y={y} width={4} dashed />
      <Lines segments={groups.locked} color={COLORS.locked} y={y} width={4} />
      {proposal && <Lines segments={proposal.walls} color={COLORS.proposal} y={y + 0.01} width={3} />}
    </group>
  )
}

// ------------------------------------------------------------------ tools

interface Stroke {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  from: Pt2
  /** Fog brush: cells painted this stroke, and the ones already sent. */
  cells: Set<string>
  sent: Set<string>
  lastSend: number
  /** Erase: what the stroke has touched so far. */
  walls: Set<WallId>
  imported: Set<number>
}

/** Tracks whether Alt is held (free placement, no snapping). */
function useAlt() {
  const alt = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') alt.current = true }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') alt.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
  return alt
}

function ToolCatcher({ tool, bounds, baseWalls }: { tool: BuildTool; bounds: Bounds2; baseWalls: readonly WallSegment[] }) {
  const { grid, floorY, sceneId, scene, onIntent } = useTable()
  const walls = useSceneWalls(sceneId)
  const snapOn = useTableUi((s) => s.snap)
  const uiSet = useTableUi((s) => s.set)
  const brush = useBuildUi((s) => s.brush)
  const stamp = useBuildUi((s) => s.stamp)
  const prefab = useGame((s) => (stamp ? s.prefabs[stamp.prefab] : undefined))
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const alt = useAlt()
  const scratch = useMemo(() => ({ plane: new Plane(new Vector3(0, 1, 0), -floorY), hit: new Vector3() }), [floorY])
  const stroke = useRef<Stroke | null>(null)
  const [pen, setPen] = useState<{ a: Pt2; b: Pt2 } | null>(null)
  const [hover, setHover] = useState<Pt2 | null>(null)
  const [painted, setPainted] = useState<{ walls: Set<WallId>; imported: Set<number> } | null>(null)
  const snap = () => snapOn && !alt.current
  const cell = grid.cellSize
  const endpoints = useMemo(() => endpointsOf([...baseWalls, ...walls]), [baseWalls, walls])
  const penPoint = (p: Pt2) => snapWallPoint(p, grid, endpoints, { snap: snap() })

  // Esc puts the tool away; R turns the prefab being stamped.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'Escape') { useBuildUi.getState().set({ tool: null }); return }
      if ((e.key === 'r' || e.key === 'R') && tool === 'prefab-stamp' && !e.metaKey && !e.ctrlKey) {
        const s = useBuildUi.getState()
        if (s.stamp) s.set({ stamp: { ...s.stamp, turns: (s.stamp.turns + (e.shiftKey ? 3 : 1)) % 4 } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool])
  // Unmounted mid-stroke (tool switched): give the camera back.
  useEffect(() => () => {
    if (stroke.current) { stroke.current = null; useTableUi.getState().set({ editDrag: false }); if (controls) controls.enabled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- fog brush
  const brushCells = (p: Pt2): string[] => {
    const keys = cellsWithinRadius(grid, p.x, p.z, brush).map(cellKey)
    keys.push(cellKey(worldToCell(grid, p.x, p.z)))
    return keys
  }
  const flushBrush = (s: Stroke, force: boolean) => {
    const now = performance.now()
    if (!force && now - s.lastSend < BRUSH_SEND_MS) return
    const fresh = [...s.cells].filter((k) => !s.sent.has(k))
    if (!fresh.length) return
    s.lastSend = now
    for (const k of fresh) s.sent.add(k)
    onIntent(tool === 'fog-reveal' ? { type: 'fog.reveal', scene: sceneId, cells: fresh } : { type: 'fog.hide', scene: sceneId, cells: fresh })
  }

  // --- eraser
  const eraseRadius = cell * 0.3
  const touchErase = (s: Stroke, p: Pt2) => {
    let changed = false
    for (const id of wallsNear(p, walls, eraseRadius)) if (!s.walls.has(id)) { s.walls.add(id); changed = true }
    for (const i of segmentsNear(p, scene.walls ?? [], eraseRadius)) if (!s.imported.has(i)) { s.imported.add(i); changed = true }
    if (changed) setPainted({ walls: new Set(s.walls), imported: new Set(s.imported) })
  }
  const nearLight = (p: Pt2): LightId | null => {
    const lights = Object.values(useGame.getState().lights).filter((l) => l.scene === sceneId)
    let best: LightId | null = null
    let bestD = cell * 0.5
    for (const l of lights) {
      const d = Math.hypot(l.position.x - p.x, l.position.z - p.z)
      if (d <= bestD) { best = l.id; bestD = d }
    }
    return best
  }

  const begin = (e: ThreeEvent<PointerEvent>, p: Pt2) => {
    try { (e.target as unknown as { setPointerCapture(id: number): void }).setPointerCapture(e.pointerId) } catch { /* Safari after a cancelled touch */ }
    if (controls) controls.enabled = false
    uiSet({ editDrag: true, hovered: null, grab: null })
    stroke.current = {
      pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false, from: p,
      cells: new Set(), sent: new Set(), lastSend: 0, walls: new Set(), imported: new Set(),
    }
  }
  const end = (e?: ThreeEvent<PointerEvent>) => {
    const s = stroke.current
    if (!s) return null
    if (e) { try { (e.target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture(s.pointerId) } catch { /* ditto */ } }
    stroke.current = null
    uiSet({ editDrag: false })
    if (controls) controls.enabled = true
    return s
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || stroke.current) return
    e.stopPropagation()
    const p = floorPoint(e, floorY, scratch)
    if (!p) return
    begin(e, p)
    const s = stroke.current!
    switch (tool) {
      case 'wall': case 'door': { const a = penPoint(p); s.from = a; setPen({ a, b: a }); break }
      case 'prefab-capture': setPen({ a: p, b: p }); break
      case 'fog-reveal': case 'fog-hide':
        for (const k of brushCells(p)) s.cells.add(k)
        flushBrush(s, true)
        break
      case 'erase': touchErase(s, p); break
      default: break
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const p = floorPoint(e, floorY, scratch)
    const s = stroke.current
    if (!s) {
      // Hover previews: the pen's snap point, the brush, the stamp ghost.
      if (p) setHover(tool === 'wall' || tool === 'door' ? penPoint(p) : p)
      return
    }
    if (e.pointerId !== s.pointerId) return
    e.stopPropagation()
    if (!s.moved && Math.hypot(e.nativeEvent.clientX - s.startX, e.nativeEvent.clientY - s.startY) >= DRAG_THRESHOLD_PX) s.moved = true
    if (!p) return
    setHover(p)
    switch (tool) {
      case 'wall': case 'door': if (s.moved) setPen({ a: s.from, b: penPoint(p) }); break
      case 'prefab-capture': if (s.moved) setPen({ a: s.from, b: p }); break
      case 'fog-reveal': case 'fog-hide':
        for (const k of brushCells(p)) s.cells.add(k)
        flushBrush(s, false)
        break
      case 'erase': touchErase(s, p); break
      default: break
    }
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const s = stroke.current
    if (!s || e.pointerId !== s.pointerId) return
    e.stopPropagation()
    const p = floorPoint(e, floorY, scratch) ?? s.from
    end(e)
    switch (tool) {
      case 'wall': case 'door': {
        setPen(null)
        const b = penPoint(p)
        if (s.moved && isDrawable(s.from, b, grid)) {
          const wall: Wall = { id: newId<'WallId'>() as WallId, scene: sceneId, a: cleanPoint(s.from), b: cleanPoint(b), source: 'drawn' }
          if (tool === 'door') wall.door = { open: false }
          onIntent({ type: 'wall.add', walls: [wall] })
        } else if (!s.moved && tool === 'door') {
          // A tap on a door with the door pen opens or closes it.
          const door = walls.filter((w) => w.door).sort((u, v) => pointSegmentDistance(p, u.a, u.b) - pointSegmentDistance(p, v.a, v.b))[0]
          if (door && pointSegmentDistance(p, door.a, door.b) <= cell * 0.4) onIntent({ type: 'door.set', wall: door.id, open: !door.door!.open })
        }
        break
      }
      case 'fog-reveal': case 'fog-hide': flushBrush(s, true); break
      case 'erase': {
        setPainted(null)
        if (!s.moved) {
          // A tap also takes away a placed light under it.
          const light = nearLight(p)
          if (light && !s.walls.size && !s.imported.size) { onIntent({ type: 'light.remove', light }); break }
        }
        if (s.walls.size) onIntent({ type: 'wall.remove', walls: [...s.walls] })
        if (s.imported.size && scene.walls) onIntent({ type: 'scene.update', scene: sceneId, patch: { walls: scene.walls.filter((_, i) => !s.imported.has(i)) } })
        break
      }
      case 'light': {
        if (s.moved) break
        const at = snap() ? snapToCell(grid, p.x, p.z) : p
        const ui = useBuildUi.getState()
        onIntent({
          type: 'light.add',
          light: { id: newId<'LightId'>() as LightId, scene: sceneId, position: { x: at.x, y: floorY, z: at.z }, radius: ui.lightRadius, color: ui.lightColor },
        })
        break
      }
      case 'prefab-capture': {
        setPen(null)
        const rect = snapRectToCells(s.from, p, grid)
        const game = useGame.getState()
        const props = Object.values(game.props).filter((x) => x.scene === sceneId)
        const n = Object.keys(game.prefabs).length + 1
        const captured = capturePrefab({ name: `Prefab ${n}`, rect, cellSize: cell, props, walls, floorY })
        if (captured.props.length || captured.walls.length) {
          onIntent({ type: 'prefab.upsert', prefab: captured })
          useBuildUi.getState().set({ tool: null })
        }
        break
      }
      case 'prefab-stamp': {
        if (s.moved || !prefab || !stamp) break
        const size = stampSize(prefab, stamp.turns, cell)
        const corner = stampCorner(p, size, grid, snap())
        const out = stampPrefab(prefab, { scene: sceneId, corner, turns: stamp.turns, cellSize: cell, floorY })
        // The whole stamp is one intent: one change, one message, one undo step.
        if (out.props.length) onIntent({ type: 'props.place', props: out.props, ...(out.walls.length ? { walls: out.walls } : {}) })
        else if (out.walls.length) onIntent({ type: 'wall.add', walls: out.walls })
        break
      }
    }
  }

  const y = floorY + 0.07
  return (
    <group>
      <FloorCatcher bounds={bounds} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { end(); setPen(null); setPainted(null) }} />
      {(tool === 'wall' || tool === 'door') && pen && (
        <Lines segments={[pen]} color={tool === 'door' ? COLORS.door : COLORS.pen} y={y} width={4} />
      )}
      {(tool === 'wall' || tool === 'door') && hover && !pen && <Marker at={hover} y={y} r={0.12 * cell} color={COLORS.pen} />}
      {tool === 'prefab-capture' && pen && <RectOutline rect={snapRectToCells(pen.a, pen.b, grid)} y={y} color={COLORS.pen} />}
      {(tool === 'fog-reveal' || tool === 'fog-hide') && hover && (
        <Marker at={hover} y={y} r={(brush + 0.5) * cell} color={tool === 'fog-reveal' ? BUILD.fogReveal : BUILD.fogHide} ring />
      )}
      {tool === 'erase' && hover && <Marker at={hover} y={y} r={eraseRadius} color={COLORS.erase} ring />}
      {tool === 'erase' && painted && (
        <Lines segments={[...walls.filter((w) => painted.walls.has(w.id)), ...(scene.walls ?? []).filter((_, i) => painted.imported.has(i))]} color={COLORS.erase} y={y + 0.005} width={6} />
      )}
      {tool === 'light' && hover && <Marker at={snap() ? (() => { const c = snapToCell(grid, hover.x, hover.z); return { x: c.x, z: c.z } })() : hover} y={y} r={0.15 * cell} color={useBuildUi.getState().lightColor} />}
      {tool === 'prefab-stamp' && hover && prefab && stamp && <StampGhost hover={hover} y={y} snap={snap()} />}
    </group>
  )
}

function Marker({ at, y, r, color, ring = false }: { at: Pt2; y: number; r: number; color: string; ring?: boolean }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[at.x, y, at.z]} raycast={noRaycast} renderOrder={21}>
      {ring ? <ringGeometry args={[Math.max(0, r - Math.max(0.03, r * 0.06)), r, 48]} /> : <circleGeometry args={[r, 24]} />}
      <meshBasicMaterial color={color} transparent opacity={ring ? 0.9 : 0.8} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

function RectOutline({ rect, y, color }: { rect: Bounds2; y: number; color: string }) {
  const segs: WallSegment[] = [
    { a: { x: rect.minX, z: rect.minZ }, b: { x: rect.maxX, z: rect.minZ } },
    { a: { x: rect.maxX, z: rect.minZ }, b: { x: rect.maxX, z: rect.maxZ } },
    { a: { x: rect.maxX, z: rect.maxZ }, b: { x: rect.minX, z: rect.maxZ } },
    { a: { x: rect.minX, z: rect.maxZ }, b: { x: rect.minX, z: rect.minZ } },
  ]
  return <Lines segments={segs} color={color} y={y} width={2} dashed />
}

/** Where a stamp would land: its footprint, walls and a dot per prop. */
function StampGhost({ hover, y, snap }: { hover: Pt2; y: number; snap: boolean }) {
  const { grid, sceneId, floorY } = useTable()
  const stamp = useBuildUi((s) => s.stamp)
  const prefab = useGame((s) => (stamp ? s.prefabs[stamp.prefab] : undefined))
  const cell = grid.cellSize
  const plan = useMemo(() => {
    if (!prefab || !stamp) return null
    const size = stampSize(prefab, stamp.turns, cell)
    const corner = stampCorner(hover, size, grid, snap)
    const out = stampPrefab(prefab, { scene: sceneId, corner, turns: stamp.turns, cellSize: cell, floorY })
    return { rect: { minX: corner.x, minZ: corner.z, maxX: corner.x + size.x, maxZ: corner.z + size.z }, ...out }
  }, [prefab, stamp, hover, grid, snap, sceneId, cell, floorY])
  if (!plan) return null
  return (
    <group>
      <RectOutline rect={plan.rect} y={y} color={COLORS.proposal} />
      <Lines segments={plan.walls} color={COLORS.wall} y={y + 0.005} />
      {plan.props.map((p) => <Marker key={p.id} at={p.position} y={y} r={0.15 * cell} color={COLORS.proposal} />)}
    </group>
  )
}

// ------------------------------------------------------------------ shared views

/**
 * Pull: every client glides to the GM's pose once (see view.ts `takePull`). Display: follows the
 * GM's shared camera, or frames the scene when the GM is not sharing. GM: publishes the camera
 * while "Share my view" is on.
 */
function ViewSync() {
  const { sceneId, viewer, onPresence } = useTable()
  const gmKey = useGame((s) => s.meta?.gm)
  const gmPresence = useGame((s) => (gmKey ? s.presence[gmKey] : undefined))
  const isGm = !!viewer?.isGm
  const follow = viewer?.display?.follow ?? false
  const seen = useRef({ at: 0 })

  useEffect(() => {
    if (isGm || !viewer) return
    const pull = takePull(seen.current, gmPresence, gmKey, sceneId)
    if (pull) requestView(pull)
  }, [gmPresence, gmKey, sceneId, isGm, viewer])

  // Displays: the GM's camera while they share it, else the whole scene (on a change of either).
  const cam = viewer?.display ? (follow ? followedCamera(gmPresence, gmKey, sceneId) : null) : undefined
  const camKey = cam === undefined ? '' : cam ? `${cam.pos.x},${cam.pos.y},${cam.pos.z},${cam.target.x},${cam.target.y},${cam.target.z}` : 'overview'
  useEffect(() => {
    if (!camKey) return
    requestView(cam ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camKey])

  const share = useBuildUi((s) => s.shareView)
  const camera = useThree((s) => s.camera)
  const last = useRef<{ view: ReturnType<typeof makeView> | null; check: number }>({ view: null, check: 0 })
  useFrame(() => {
    if (!isGm || !share) return
    const now = performance.now()
    if (now - last.current.check < CAMERA_SHARE_INTERVAL_MS) return
    last.current.check = now
    const target = tableRuntime.cameraTarget
    if (!target) return
    const view = makeView(sceneId, { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target)
    // Re-sent now and then even when still, so displays can tell a quiet GM from a gone one.
    const prev = last.current.view
    if (!viewMoved(prev, view) && prev && view.at - prev.at < 5000) return
    last.current.view = view
    onPresence({ camera: view })
  })
  useEffect(() => {
    if (!isGm || share) return
    if (last.current.view) { last.current.view = null; onPresence({ camera: undefined }) }
  }, [isGm, share, onPresence])
  return null
}
