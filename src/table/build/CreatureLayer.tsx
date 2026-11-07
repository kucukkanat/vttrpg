/**
 * Holding creatures from the Library (tool 'creature'): translucent discs of the tokens follow the
 * cursor, clustered on free cells; a still click places them (hidden unless "Place visible" is
 * on). Esc or right-click puts them down. A single creature stays in hand for the next click; an
 * encounter is placed once.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useGame } from '@/state/store'
import { BUILD } from '@/ui/theme/palette'
import { useTable } from '../context'
import type { Bounds2 } from '../grid'
import { FloorCatcher, FloorLabel } from '../RulerLayer'
import { putDownModel, useBuildUi } from './buildState'
import { creatureGhost } from './creaturePickup'

const noRaycast = () => undefined
const DRAG_THRESHOLD_PX = 6

export function CreatureLayer({ bounds }: { bounds: Bounds2 }) {
  const { grid, floorY, sceneId } = useTable()
  const held = useBuildUi((s) => s.creatures)
  const visible = useBuildUi((s) => s.placeVisible)
  const tokens = useGame((s) => s.tokens)
  const [hover, setHover] = useState<{ x: number; y: number; z: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const press = useRef<{ id: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); putDownModel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const ghost = useMemo(
    () => (held && hover ? creatureGhost(grid, hover, held, Object.values(tokens), sceneId) : []),
    [held, hover, grid, tokens, sceneId],
  )

  const onMove = (e: ThreeEvent<PointerEvent>) => setHover({ x: e.point.x, y: floorY, z: e.point.z })
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) { e.stopPropagation(); putDownModel(); return }
    if (e.button === 0) press.current = { id: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const p = press.current
    press.current = null
    if (!p || p.id !== e.pointerId || !held || busy) return
    if (Math.hypot(e.nativeEvent.clientX - p.x, e.nativeEvent.clientY - p.y) >= DRAG_THRESHOLD_PX) return
    e.stopPropagation()
    const at = { x: e.point.x, y: floorY, z: e.point.z }
    setBusy(true)
    void held.place(at, !useBuildUi.getState().placeVisible).finally(() => {
      setBusy(false)
      if (held.once) putDownModel()
    })
  }

  const r = grid.cellSize * 0.38
  return (
    <group>
      <FloorCatcher bounds={bounds} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null }} />
      {ghost.map((g, i) => (
        <group key={i} position={[g.position.x, floorY + 0.02, g.position.z]}>
          <mesh position-y={0.06} raycast={noRaycast} renderOrder={21}>
            <cylinderGeometry args={[r, r, 0.12, 32]} />
            <meshBasicMaterial color={g.color} transparent opacity={0.5} depthWrite={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.005} raycast={noRaycast} renderOrder={21}>
            <ringGeometry args={[r * 0.98, r * 1.12, 40]} />
            <meshBasicMaterial color={BUILD.proposal} transparent opacity={0.9} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {held && hover && ghost[0] && (
        <FloorLabel x={ghost[0].position.x} y={floorY + 0.3} z={ghost[0].position.z} color={BUILD.proposal}>
          {busy ? 'Placing…' : `${held.title}${held.tokens.length > 1 ? ` ×${held.tokens.length}` : ''} · ${visible ? 'visible' : 'hidden'}`}
        </FloorLabel>
      )}
    </group>
  )
}
