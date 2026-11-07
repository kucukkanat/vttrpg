/**
 * Building together (reports/Level design plan.md, Phase 5): GMs and co-GMs in Build see each
 * other at work. Mounted inside the canvas for GMs only; players never see any of it (and the
 * controller drops build presence before it reaches a player's store, see `admitPresence`).
 *
 * - Sending: while in Build, the floor point under the pointer (`presence.cursor`, about 10 Hz
 *   while it moves), the held model (catalogue id, where its ghost rests, its turn) and the
 *   selected prop ids go out over the presence channel. Leaving Build or 30 s without activity
 *   clears them (`BuildPresenceTracker`).
 * - Drawing: each other builder's cursor as a ring in their colour with their name, a faint ghost
 *   of what they hold, and a thin outline in their colour around the props they have selected.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { activeBuilders, BUILD_SEND_MS, BuildPresenceTracker } from '@/core/builderPresence'
import type { Presence, PresenceBuild } from '@/core/presence'
import type { CatalogueEntry } from '@/core/catalogue'
import type { PropId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useBuiltinCatalogue } from '@/ui/library/useCatalogue'
import { useTable } from '../context'
import { FloorLabel } from '../RulerLayer'
import { useTableUi } from '../tableState'
import { useBuildUi } from './buildState'
import { builderLocal, propBounds } from './editRuntime'
import { GhostPiece, SizeBox } from './PlaceLayer'
import { useFrameStats } from './sceneBudget'

const noRaycast = () => undefined
/** Other builders' ghosts are fainter than your own. */
const REMOTE_GHOST_OPACITY = 0.28
/** Re-check who is still around this often, so a silent builder fades out. */
const RECHECK_MS = 2_000

export function BuilderPresence() {
  const { viewer } = useTable()
  if (!viewer?.isGm || viewer.display) return null
  return (
    <>
      <BuilderSender />
      <OtherBuilders me={viewer.pubkey} />
      <FrameStatsProbe />
    </>
  )
}

/** How often the Build tray's budget meter gets a new frame sample. */
const FRAME_SAMPLE_MS = 500

/**
 * In Build: samples the last frame's triangles and draw calls from `renderer.info` for the tray's
 * budget meter. Runs before each render, so it reads the previous frame; never asks for frames.
 */
function FrameStatsProbe() {
  const buildMode = useTableUi((s) => s.buildMode)
  const last = useRef(0)
  useFrame(({ gl }) => {
    if (!buildMode) return
    const now = performance.now()
    if (now - last.current < FRAME_SAMPLE_MS) return
    last.current = now
    const { triangles, calls } = gl.info.render
    const cur = useFrameStats.getState()
    if (cur.triangles !== triangles || cur.calls !== calls) useFrameStats.setState({ triangles, calls, at: Date.now() })
  })
  return null
}

/** Publishes this GM's cursor, hand and selection while in Build. */
function BuilderSender() {
  const { sceneId, floorY, onPresence } = useTable()
  const buildMode = useTableUi((s) => s.buildMode)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const tracker = useRef(new BuildPresenceTracker()).current
  const cursor = useRef<{ x: number; y: number; z: number } | null>(null)
  const sendRef = useRef(onPresence)
  sendRef.current = onPresence

  // Pointer over the board: the floor point under it.
  useEffect(() => {
    if (!buildMode) return
    const el = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    const plane = new Plane(new Vector3(0, 1, 0), -floorY)
    const hit = new Vector3()
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      cursor.current = ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: floorY, z: hit.z } : null
      tracker.touch(Date.now())
    }
    const leave = () => { cursor.current = null; tracker.touch(Date.now()) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave) }
  }, [buildMode, gl, camera, floorY, tracker])

  // Turning, picking up and selecting count as activity too.
  useEffect(() => {
    if (!buildMode) return
    tracker.touch(Date.now())
    const offBuild = useBuildUi.subscribe((s, prev) => { if (s.held !== prev.held || s.yaw !== prev.yaw || s.tool !== prev.tool) tracker.touch(Date.now()) })
    const offSel = useGame.subscribe((s, prev) => { if (s.propSelection !== prev.propSelection) tracker.touch(Date.now()) })
    return () => { offBuild(); offSel() }
  }, [buildMode, tracker])

  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      let state = null
      if (buildMode) {
        const b = useBuildUi.getState()
        const at = builderLocal.heldAt
        const held = b.tool === 'place' && b.held && at ? { catalogue: b.held.catalogue, at, yaw: b.yaw + (b.scatter ? b.roll.yaw : 0) } : null
        state = { scene: sceneId, cursor: cursor.current, held, selection: useGame.getState().propSelection }
      }
      const out = tracker.step(now, state)
      if (out) sendRef.current(out)
    }
    tick()
    const id = setInterval(tick, BUILD_SEND_MS)
    return () => {
      clearInterval(id)
      // Leaving Build, the scene or the table: take the cursor and hand away for everyone.
      const out = tracker.step(Date.now(), null)
      if (out) sendRef.current(out)
    }
  }, [buildMode, sceneId, tracker])
  return null
}

/** The other builders in this scene: cursor rings, ghosts and selection outlines. */
function OtherBuilders({ me }: { me: string }) {
  const { sceneId } = useTable()
  const presence = useGame((s) => s.presence)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RECHECK_MS)
    return () => clearInterval(id)
  }, [])
  const builders = useMemo(() => activeBuilders(presence, { me, scene: sceneId, now }), [presence, me, sceneId, now])
  const holding = builders.some((b) => b.build?.held?.id)
  const builtin = useBuiltinCatalogue(holding)
  const mine = useGame((s) => s.catalogue)
  const lookup = (id: string | undefined): CatalogueEntry | undefined => (id ? mine[id] ?? builtin?.find((e) => e.id === id) : undefined)
  if (!builders.length) return null
  return (
    <group>
      {builders.map((b) => (
        <group key={b.pubkey}>
          {b.cursor && <CursorRing at={b.cursor} color={b.color} name={b.name} />}
          {b.build?.held && <RemoteGhost held={b.build.held} entry={lookup(b.build.held.id)} color={b.color} />}
          {b.build?.sel && <SelectionOutlines build={b.build} color={b.color} />}
        </group>
      ))}
    </group>
  )
}

function CursorRing({ at, color, name }: { at: NonNullable<Presence['cursor']>; color: string; name: string }) {
  return (
    <group position={[at.x, at.y + 0.02, at.z]}>
      <mesh rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={22}>
        <ringGeometry args={[0.18, 0.26, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} depthTest={false} />
      </mesh>
      <FloorLabel x={0} y={0.45} z={0} color={color}>{name}</FloorLabel>
    </group>
  )
}

function RemoteGhost({ held, entry, color }: { held: NonNullable<PresenceBuild['held']>; entry: CatalogueEntry | undefined; color: string }) {
  return (
    <group position={[held.at.x, held.at.y, held.at.z]} rotation-y={held.yaw}>
      {entry
        ? <GhostPiece model={entry.model} title={entry.title} scale={{ x: 1, y: 1, z: 1 }} size={entry.size} opacity={REMOTE_GHOST_OPACITY} color={color} />
        : <SizeBox color={color} />}
    </group>
  )
}

/** A thin floor rectangle in the builder's colour around each prop they have selected. */
function SelectionOutlines({ build, color }: { build: PresenceBuild; color: string }) {
  const props = useGame((s) => s.props)
  const rects = useMemo(() => {
    const out: Array<{ id: string; pts: [number, number, number][] }> = []
    const box = new Box3()
    for (const id of build.sel ?? []) {
      const p = props[id as PropId]
      if (!p || p.scene !== build.scene) continue
      const b = propBounds(p.id, box)
      const pad = 0.06
      const [x0, x1, z0, z1] = b && !b.isEmpty()
        ? [b.min.x - pad, b.max.x + pad, b.min.z - pad, b.max.z + pad]
        : [p.position.x - 0.35, p.position.x + 0.35, p.position.z - 0.35, p.position.z + 0.35]
      const y = (b && !b.isEmpty() ? b.min.y : p.position.y) + 0.03
      out.push({ id, pts: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]] })
    }
    return out
  }, [build, props])
  return (
    <>
      {rects.map((r) => <Line key={r.id} points={r.pts} color={color} lineWidth={1.5} transparent opacity={0.9} depthTest={false} renderOrder={22} raycast={noRaycast} />)}
    </>
  )
}
