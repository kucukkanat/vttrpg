/**
 * Measuring distances on the table. Mounted inside the <Canvas>; draws nothing until
 * `tableUi.tool === 'ruler'` (HUD button, M key). Then a floor catcher takes every pointer:
 * pointer-down starts a measurement at the snapped cell, a drag (mouse or one finger) extends it,
 * release leaves the line and its label on the table until the next tap or Esc. Esc with nothing
 * measured turns the tool off. Camera controls stay off during the drag (`editDrag`, the flag prop
 * and gizmo drags use) and tokens take no pointer events while a tool is active (see FloorCatcher).
 * The maths (snapping, steps, label) is in ruler.ts.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Html } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3 } from 'three'
import { useGame } from '@/state/store'
import { useTable } from './context'
import type { Bounds2 } from './grid'
import { measure, type Measurement, type RulerPoint } from './ruler'
import { useTableUi } from './tableState'

/**
 * three.js layer the tool catcher lives on. While a catcher is mounted the pointer raycaster only
 * sees that layer, so tokens, props and gizmo handles under the pointer are left alone without
 * them knowing about the tool.
 */
export const TOOL_LAYER = 7

const DRAG_THRESHOLD_PX = 8
const COLOR = '#ffd166'
const noRaycast = () => undefined

type CaptureTarget = { setPointerCapture(id: number): void; releasePointerCapture(id: number): void }
const capture = (e: ThreeEvent<PointerEvent>) => {
  const t = e.target as unknown as CaptureTarget
  return {
    set(id: number) { try { t.setPointerCapture(id) } catch { /* Safari after a cancelled touch */ } },
    release(id: number) { try { t.releasePointerCapture(id) } catch { /* ditto */ } },
  }
}

export interface FloorCatcherProps {
  bounds: Bounds2
  onPointerDown?(e: ThreeEvent<PointerEvent>): void
  onPointerMove?(e: ThreeEvent<PointerEvent>): void
  onPointerUp?(e: ThreeEvent<PointerEvent>): void
  onPointerCancel?(): void
}

/**
 * An invisible plane over the whole floor that owns the pointer while a tool is active. Mounting
 * it narrows the raycaster to TOOL_LAYER; unmounting restores it. Handlers get the usual R3F
 * events; use `floorPoint` to turn one into a floor position.
 */
export function FloorCatcher({ bounds, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: FloorCatcherProps) {
  const { grid, floorY } = useTable()
  const raycaster = useThree((s) => s.raycaster)
  useEffect(() => {
    const previous = raycaster.layers.mask
    raycaster.layers.set(TOOL_LAYER)
    return () => { raycaster.layers.mask = previous }
  }, [raycaster])
  const w = bounds.maxX - bounds.minX + 40 * grid.cellSize
  const h = bounds.maxZ - bounds.minZ + 40 * grid.cellSize
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[(bounds.minX + bounds.maxX) / 2, floorY + 0.001, (bounds.minZ + bounds.maxZ) / 2]}
      layers={TOOL_LAYER}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onContextMenu={(e) => { e.stopPropagation(); e.nativeEvent.preventDefault() }}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  )
}

/** Where the event's ray meets the floor plane at `floorY`, as (x, z); null when it misses. */
export function floorPoint(e: ThreeEvent<PointerEvent>, floorY: number, scratch: { plane: Plane; hit: Vector3 }): RulerPoint | null {
  scratch.plane.set(scratch.plane.normal, -floorY)
  if (!e.ray.intersectPlane(scratch.plane, scratch.hit)) return null
  return { x: scratch.hit.x, z: scratch.hit.z }
}

/** Small floating text over the floor; pointer events pass through it. */
export function FloorLabel({ x, y, z, color, children }: { x: number; y: number; z: number; color: string; children: ReactNode }) {
  return (
    <Html position={[x, y, z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{
        padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600, lineHeight: 1.3,
        fontFamily: 'system-ui, sans-serif', color: '#f3ead8', background: 'rgba(14,14,16,0.85)', border: `1px solid ${color}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)', userSelect: 'none',
      }}>{children}</div>
    </Html>
  )
}

export function RulerLayer({ bounds }: { bounds: Bounds2 }) {
  const active = useTableUi((s) => s.tool === 'ruler')
  return active ? <Ruler bounds={bounds} /> : null
}

function Ruler({ bounds }: { bounds: Bounds2 }) {
  const { grid, floorY } = useTable()
  const pack = useGame((s) => s.meta?.pack ?? null)
  const uiSet = useTableUi((s) => s.set)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const [line, setLine] = useState<{ from: RulerPoint; to: RulerPoint } | null>(null)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const scratch = useMemo(() => ({ plane: new Plane(new Vector3(0, 1, 0), -floorY), hit: new Vector3() }), [floorY])

  // Esc clears the measurement, or turns the tool off when there is none. Tool off: end any drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setLine((l) => { if (!l) uiSet({ tool: null }); return null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [uiSet])
  useEffect(() => () => {
    if (drag.current) { drag.current = null; uiSet({ editDrag: false }); if (controls) controls.enabled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endDrag = (e?: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    if (e) capture(e).release(d.pointerId)
    drag.current = null
    uiSet({ editDrag: false })
    if (controls) controls.enabled = true
    return d
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || drag.current) return
    e.stopPropagation()
    const p = floorPoint(e, floorY, scratch)
    if (!p) return
    capture(e).set(e.pointerId)
    if (controls) controls.enabled = false
    uiSet({ editDrag: true, hovered: null, grab: null })
    drag.current = { pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false }
    setLine({ from: p, to: p })
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (!d.moved && Math.hypot(e.nativeEvent.clientX - d.startX, e.nativeEvent.clientY - d.startY) >= DRAG_THRESHOLD_PX) d.moved = true
    if (!d.moved) return
    const p = floorPoint(e, floorY, scratch)
    if (p) setLine((l) => (l ? { from: l.from, to: p } : l))
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    const p = d.moved ? floorPoint(e, floorY, scratch) : null
    endDrag(e)
    // A plain tap clears the last measurement; a drag leaves its line on the table.
    if (!d.moved) setLine(null)
    else if (p) setLine((l) => (l ? { from: l.from, to: p } : l))
  }

  const m: Measurement | null = useMemo(() => (line ? measure(grid, line.from, line.to, pack) : null), [grid, line, pack])

  return (
    <group>
      <FloorCatcher bounds={bounds} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => endDrag()} />
      {m && <RulerLine m={m} cellSize={grid.cellSize} y={floorY + 0.02} />}
    </group>
  )
}

/** The measurement on the floor: a ribbon between the snapped endpoints, a disc at each end, the label above the middle. */
function RulerLine({ m, cellSize, y }: { m: Measurement; cellSize: number; y: number }) {
  const dx = m.to.x - m.from.x
  const dz = m.to.z - m.from.z
  const len = Math.hypot(dx, dz)
  const mid = { x: (m.from.x + m.to.x) / 2, z: (m.from.z + m.to.z) / 2 }
  const r = 0.12 * cellSize
  return (
    <group>
      {len > 1e-4 && (
        <group position={[mid.x, y, mid.z]} rotation-y={-Math.atan2(dz, dx)}>
          <mesh rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={5}>
            <planeGeometry args={[len, 0.06 * cellSize]} />
            <meshBasicMaterial color={COLOR} transparent opacity={0.9} depthWrite={false} />
          </mesh>
        </group>
      )}
      {[m.from, m.to].map((p, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[p.x, y + 0.005, p.z]} raycast={noRaycast} renderOrder={5}>
          <ringGeometry args={[r * 0.6, r, 32]} />
          <meshBasicMaterial color={COLOR} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      ))}
      <FloorLabel x={mid.x} y={y + 0.35 * cellSize} z={mid.z} color={COLOR}>{m.label}</FloorLabel>
    </group>
  )
}
