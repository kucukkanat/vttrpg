/**
 * The Invisible wall and Invisible door tools on the board (segmentTool.ts has the rules): a
 * floor catcher that owns the pointer, a live ghost line from the start to the snapped cursor,
 * and one `props.place` per finished segment. Esc or a right-click stops; Esc again puts the
 * tool away.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Line } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import { newId, type PropId } from '@/core/ids'
import { propSegment, type P2 } from '@/core/propParts'
import { useGame } from '@/state/store'
import { BUILD } from '@/ui/theme/palette'
import { useTable } from '../context'
import type { Bounds2 } from '../grid'
import { modelBoundsOf } from '../modelBounds'
import { FloorCatcher, FloorLabel, floorPoint } from '../RulerLayer'
import { useTableUi } from '../tableState'
import { useBuildUi } from './buildState'
import { IDLE, segmentClick, segmentDrag, stretchedProp, type SegmentKind, type SegmentState } from './segmentTool'
import { endpointsOf, snapWallPoint } from './wallEdit'

const noRaycast = () => undefined
const DRAG_PX = 6

export function SegmentLayer({ kind, bounds }: { kind: SegmentKind; bounds: Bounds2 }) {
  const { grid, floorY, sceneId, scene, onIntent, viewer } = useTable()
  const snapOn = useTableUi((s) => s.snap)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const props = useGame((s) => s.props)
  const scratch = useMemo(() => ({ plane: new Plane(new Vector3(0, 1, 0), -floorY), hit: new Vector3() }), [floorY])
  const [state, setState] = useState<SegmentState>(IDLE)
  const stateRef = useRef(state)
  stateRef.current = state
  const [cursor, setCursor] = useState<P2 | null>(null)
  const press = useRef<{ pointerId: number; x: number; y: number; at: P2; moved: boolean } | null>(null)
  const alt = useRef(false)

  // Ends of the walls and doors already in the scene, so new ones join them.
  const endpoints = useMemo(() => {
    const segs = Object.values(props).filter((p) => p.scene === sceneId && (p.wall || p.door))
      .map((p) => propSegment(p, modelBoundsOf(p), grid.cellSize)).filter((s): s is NonNullable<typeof s> => !!s)
    return endpointsOf([...segs, ...(scene.walls ?? [])])
  }, [props, sceneId, scene.walls, grid.cellSize])
  const snap = (p: P2) => snapWallPoint(p, grid, endpoints, { snap: snapOn && !alt.current })

  const place = (seg: { a: P2; b: P2 }) => {
    const prop = stretchedProp(kind, seg, sceneId, floorY, newId<'PropId'>() as PropId)
    if (viewer?.pubkey) prop.createdBy = viewer.pubkey
    onIntent({ type: 'props.place', props: [prop] })
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') alt.current = true
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key !== 'Escape') return
      // First Esc ends the chain, the second puts the tool away.
      if (!stateRef.current.start) useBuildUi.getState().set({ tool: null })
      else setState(IDLE)
    }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') alt.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
  useEffect(() => () => { if (controls) controls.enabled = true }, [controls])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) { e.stopPropagation(); setState(IDLE); return }
    if (e.button !== 0) return
    e.stopPropagation()
    const p = floorPoint(e, floorY, scratch)
    if (!p) return
    press.current = { pointerId: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, at: snap(p), moved: false }
    // The door tool drags across the doorway: hold the camera still.
    if (kind === 'door' && controls) controls.enabled = false
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const p = floorPoint(e, floorY, scratch)
    if (p) setCursor(snap(p))
    const pr = press.current
    if (pr && e.pointerId === pr.pointerId && Math.hypot(e.nativeEvent.clientX - pr.x, e.nativeEvent.clientY - pr.y) >= DRAG_PX) pr.moved = true
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const pr = press.current
    if (!pr || e.pointerId !== pr.pointerId) return
    press.current = null
    if (controls) controls.enabled = true
    e.stopPropagation()
    const p = floorPoint(e, floorY, scratch)
    const at = p ? snap(p) : pr.at
    if (kind === 'door' && pr.moved && !state.start) {
      const seg = segmentDrag(pr.at, at)
      if (seg) place(seg)
      return
    }
    if (pr.moved && kind === 'wall') return // a camera drag, not a click
    const r = segmentClick(kind, state, at)
    if (r.place) place(r.place)
    setState(r.state)
  }

  const from = press.current && kind === 'door' && press.current.moved && !state.start ? press.current.at : state.start
  const y = floorY + 0.07
  const len = from && cursor ? Math.hypot(cursor.x - from.x, cursor.z - from.z) : 0
  const color = kind === 'door' ? BUILD.door : BUILD.pen
  return (
    <>
      <FloorCatcher bounds={bounds} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { press.current = null; if (controls) controls.enabled = true }} />
      {cursor && (
        <mesh position={[cursor.x, y, cursor.z]} rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={22}>
          <ringGeometry args={[0.08 * grid.cellSize, 0.13 * grid.cellSize, 20]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
      {from && cursor && len > 0.01 && (
        <>
          <Line points={[[from.x, y, from.z], [cursor.x, y, cursor.z]]} color={color} lineWidth={kind === 'door' ? 5 : 3} dashed={kind === 'wall'} dashSize={0.2} gapSize={0.1}
            depthTest={false} transparent opacity={0.9} renderOrder={22} raycast={noRaycast} />
          <FloorLabel x={(from.x + cursor.x) / 2} y={y + 0.2} z={(from.z + cursor.z) / 2} color={color}>
            {`${kind === 'door' ? 'Door' : 'Wall'} ${(len / grid.cellSize).toFixed(1)} cells`}
          </FloorLabel>
        </>
      )}
    </>
  )
}
