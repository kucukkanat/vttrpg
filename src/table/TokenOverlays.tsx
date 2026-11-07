/**
 * What a token shows on the table besides itself (TokenMesh mounts these):
 * - TurnRing: a pulsing gold double ring on the footprint of the combatant whose turn it is.
 * - TargetRing: the red-orange ring with crosshair ticks on a token inside the aimed shape.
 * - Nameplate: the token's name floating above it (DOM label, pointer events pass through).
 * - MoveTrail: while the viewer drags a token, the straight path's cells tinted on the floor and
 *   the distance ("4 cells · 6 m") at the ghost. The maths is in moveDistance.ts.
 * None of them takes pointer events.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { CircleGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, RingGeometry, type Mesh } from 'three'
import type { GridSpec } from '@/core/geometry'
import { cellToWorld, hexRadius } from './grid'
import { moveMeasure, pathCells } from './moveDistance'
import type { RulerPoint } from './ruler'
import { FloorLabel } from './RulerLayer'
import { HOSTILE, LABEL_GLASS, MEASURE, MINE, NOW, PARCHMENT } from '@/ui/theme/palette'

const noRaycast = () => undefined

/** Colour of the current turn: gold, which means "now" and nothing else (--now in the UI). */
export const TURN_COLOR = NOW
const TRAIL_COLOR = MEASURE

let turnGeometry: { outer: RingGeometry; inner: RingGeometry } | null = null
function turnRings() {
  turnGeometry ??= { outer: new RingGeometry(1.34, 1.52, 64), inner: new RingGeometry(1.18, 1.24, 64) }
  return turnGeometry
}

/** Pulsing double ring outside the selection ring (which ends at 1.3 radii). */
export function TurnRing({ radius }: { radius: number }) {
  const pulse = useRef<Mesh>(null)
  const pulseMat = useMemo(() => new MeshBasicMaterial({ color: TURN_COLOR, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }), [])
  const steadyMat = useMemo(() => new MeshBasicMaterial({ color: TURN_COLOR, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), [])
  useLayoutEffect(() => () => { pulseMat.dispose(); steadyMat.dispose() }, [pulseMat, steadyMat])
  useFrame(({ clock }) => {
    const m = pulse.current
    if (!m) return
    const w = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.2) // 0..1, about one beat every two seconds
    const s = radius * (1 + 0.1 * w)
    m.scale.set(s, s, 1)
    pulseMat.opacity = 0.95 - 0.5 * w
  })
  const g = turnRings()
  return (
    <group rotation-x={-Math.PI / 2} position-y={0.006} raycast={noRaycast}>
      <mesh ref={pulse} geometry={g.outer} material={pulseMat} scale={[radius, radius, 1]} renderOrder={4} raycast={noRaycast} />
      <mesh geometry={g.inner} material={steadyMat} scale={[radius, radius, 1]} renderOrder={4} raycast={noRaycast} />
    </group>
  )
}

let targetGeometry: { ring: RingGeometry; tick: PlaneGeometry } | null = null
const targetMaterials = new Map<string, MeshBasicMaterial>()
/**
 * A token inside the aimed shape: a ring in the template colour (red-orange unless the skill helps)
 * plus four crosshair ticks crossing it, so the mark reads without its colour. Scaled to the token.
 */
export function TargetRing({ radius, color = HOSTILE }: { radius: number; color?: string }) {
  targetGeometry ??= { ring: new RingGeometry(1.1, 1.38, 48), tick: new PlaneGeometry(0.1, 0.5) }
  let m = targetMaterials.get(color)
  if (!m) {
    m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })
    targetMaterials.set(color, m)
  }
  const g = targetGeometry
  return (
    <group rotation-x={-Math.PI / 2} position-y={0.012} scale={[radius, radius, 1]} raycast={noRaycast}>
      <mesh geometry={g.ring} material={m} renderOrder={6} raycast={noRaycast} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2
        return <mesh key={i} geometry={g.tick} material={m} position={[Math.cos(a) * 1.24, Math.sin(a) * 1.24, 0]} rotation-z={a + Math.PI / 2} renderOrder={6} raycast={noRaycast} />
      })}
    </group>
  )
}

/**
 * The token's name above it. `accent` outlines the label (owner colour, or the turn colour);
 * `mine` adds a small "you" tag so the viewer's own token reads at a glance.
 */
export function Nameplate({ name, y, accent, mine, current }: { name: string; y: number; accent: string | null; mine: boolean; current: boolean }) {
  return (
    <Html position={[0, y, 0]} zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }} pointerEvents="none">
      <div style={{
        transform: 'translate(-50%, calc(-100% - 2px))', display: 'inline-flex', alignItems: 'center', gap: 4,
        maxWidth: 160, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', overflow: 'hidden',
        fontFamily: 'var(--font-display)', fontSize: 'calc(var(--fs-sm) + 1px)', fontWeight: 700, lineHeight: '18px', color: PARCHMENT,
        background: LABEL_GLASS, border: `1px solid ${current ? TURN_COLOR : accent ?? 'rgba(255,255,255,0.18)'}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.45)', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none',
      }}>
        {mine && <span style={{ flex: 'none', fontFamily: 'var(--font-body)', fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: accent ?? MINE }}>you</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </div>
    </Html>
  )
}

const tmp = new Object3D()
let trailShared: { square: PlaneGeometry; hex: CircleGeometry; material: MeshBasicMaterial } | null = null
function trail() {
  trailShared ??= {
    square: new PlaneGeometry(1, 1),
    // Pointy-top hex of circumradius 1 (corners at 30° + k·60°, the way hexCorners draws them).
    hex: new CircleGeometry(1, 6, Math.PI / 6),
    material: new MeshBasicMaterial({ color: new Color(TRAIL_COLOR), transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }),
  }
  return trailShared
}

/** Tinted path cells and the distance label for a drag from `from` to `to` (world x/z, floor at `y`). */
export function MoveTrail({ grid, from, to, y, pack }: { grid: GridSpec; from: RulerPoint; to: RulerPoint; y: number; pack: string | null }) {
  const m = useMemo(() => moveMeasure(grid, from, to, pack), [grid, from, to, pack])
  const cells = useMemo(() => pathCells(grid, from, to), [grid, from, to])
  const mesh = useRef<InstancedMesh>(null)
  const s = trail()
  const size = grid.type === 'hex' ? hexRadius(grid.cellSize) * 0.94 : grid.cellSize * 0.92
  useLayoutEffect(() => {
    const im = mesh.current
    if (!im) return
    cells.forEach((c, i) => {
      const w = cellToWorld(grid, c)
      tmp.position.set(w.x, y, w.y)
      tmp.rotation.set(-Math.PI / 2, 0, 0)
      tmp.scale.set(size, size, 1)
      tmp.updateMatrix()
      im.setMatrixAt(i, tmp.matrix)
    })
    im.count = cells.length
    im.instanceMatrix.needsUpdate = true
  }, [cells, grid, y, size])
  if (m.steps <= 0) return null
  const dx = m.to.x - m.from.x
  const dz = m.to.z - m.from.z
  const len = Math.hypot(dx, dz)
  return (
    <group raycast={noRaycast}>
      {cells.length > 0 && (
        <instancedMesh key={cells.length} ref={mesh} args={[grid.type === 'hex' ? s.hex : s.square, s.material, cells.length]} renderOrder={2} frustumCulled={false} raycast={noRaycast} />
      )}
      {len > 1e-4 && (
        <mesh position={[(m.from.x + m.to.x) / 2, y + 0.002, (m.from.z + m.to.z) / 2]} rotation={[-Math.PI / 2, 0, -Math.atan2(dz, dx)]} renderOrder={3} raycast={noRaycast}>
          <planeGeometry args={[len, 0.05 * grid.cellSize]} />
          <meshBasicMaterial color={TRAIL_COLOR} transparent opacity={0.75} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <FloorLabel x={m.to.x} y={y + 0.75 * grid.cellSize} z={m.to.z} color={TRAIL_COLOR}>{m.label}</FloorLabel>
    </group>
  )
}
