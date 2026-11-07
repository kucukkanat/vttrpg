/**
 * What the `light`, `wall` and `door` parts of props draw (src/core/propParts.ts):
 *
 * - Light props: a three.js point light (or a spot pointing down) above the prop, flickering when
 *   asked, for everyone. No shadows, as placed lights never had them; a per-tier cap keeps a
 *   torch-lined hall within the light budget of weak devices.
 * - Invisible props (no model): GM-only gizmos. A wall is a line; a door a thicker line that
 *   opens a gap when open; a light source a small bulb. Each has a hit target so the GM can
 *   select and drag it like any prop, and a door is clicked open or closed (players too, where
 *   they may, through an invisible hit target that lights up on hover).
 *
 * Visible door models swing on their hinge in PropMesh; doorway models get a leaf here.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Line, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { PointLight, SpotLight, Object3D } from 'three'
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import { hasModel, lightEmitter, localParts, type LightEmitter, type Segment } from '@/core/propParts'
import { propScale } from '@/core/props'
import { useGame } from '@/state/store'
import { BUILD, HOVER, SELECT } from '@/ui/theme/palette'
import { useTable } from './context'
import { modelBoundsOf, useModelBoundsVersion } from './modelBounds'
import { usePropPointer } from './propPointer'
import { flickerNoise } from './SceneModel'
import { useTableUi } from './tableState'
import { registerPropObject } from './build/editRuntime'
import type { GraphicsTier } from './graphics'

const noRaycast = () => undefined

/** Most light props drawn at once, per graphics tier (each extra light costs every lit pixel). */
export const PROP_LIGHT_CAP: Record<GraphicsTier, number> = { battery: 4, low: 8, medium: 16, high: 32 }

/** The props of a scene that have a part (a cheap filter; each part memoises on its prop). */
function usePartProps(sceneId: SceneId): { lights: Prop[]; invisible: Prop[]; leaves: Prop[] } {
  const props = useGame((s) => s.props)
  return useMemo(() => {
    const list = Object.values(props).filter((p) => p.scene === sceneId && (p.light || p.wall || p.door))
    return {
      lights: list.filter((p) => p.light),
      invisible: list.filter((p) => !hasModel(p)),
      // Doorway models (a wall with a door in it) get a swinging leaf; a door model swings itself.
      leaves: list.filter((p) => hasModel(p) && p.wall && p.door),
    }
  }, [props, sceneId])
}

export function PropParts({ sceneId }: { sceneId: SceneId }) {
  const { lights, invisible, leaves } = usePartProps(sceneId)
  return (
    <>
      <PropLights lights={lights} />
      {invisible.map((p) => <MemoInvisiblePart key={p.id} prop={p} />)}
      {leaves.map((p) => <MemoDoorwayLeaf key={p.id} prop={p} />)}
    </>
  )
}

// ------------------------------------------------------------------ lights

function PropLights({ lights }: { lights: Prop[] }) {
  const { grid, graphics } = useTable()
  const preview = useTableUi((s) => s.propPreview)
  const version = useModelBoundsVersion((s) => s.version)
  const emitters = useMemo(() => {
    void version
    const out: { id: PropId; e: LightEmitter }[] = []
    for (const p of lights) {
      const pose = preview?.[p.id]
      const e = lightEmitter(pose ? { ...p, position: pose.position, scale: pose.scale } : p, grid.cellSize, hasModel(p) ? modelBoundsOf(p) : undefined)
      if (e) out.push({ id: p.id, e })
    }
    return out.slice(0, PROP_LIGHT_CAP[graphics.tier] ?? 16)
  }, [lights, preview, grid.cellSize, graphics.tier, version])
  return <>{emitters.map(({ id, e }, i) => <PropLight key={id} e={e} seed={i + 1} />)}</>
}

function PropLight({ e, seed }: { e: LightEmitter; seed: number }) {
  const point = useRef<PointLight>(null)
  const spot = useRef<SpotLight>(null)
  const { floorY } = useTable()
  useFrame(({ clock }) => {
    if (!e.flicker) return
    const l = point.current ?? spot.current
    if (l) l.intensity = e.intensity * (1 + 0.18 * flickerNoise(clock.elapsedTime, seed))
  })
  if (e.kind === 'spot') {
    return (
      <spotLight ref={spot} position={[e.x, e.y, e.z]} color={e.color} distance={e.distance} decay={2} intensity={e.intensity}
        angle={e.angle} penumbra={0.4}
        onUpdate={(l: SpotLight) => { l.target.position.set(e.x, floorY, e.z); l.target.updateMatrixWorld() }} />
    )
  }
  return <pointLight ref={point} position={[e.x, e.y, e.z]} color={e.color} distance={e.distance} decay={2} intensity={e.intensity} />
}

// ------------------------------------------------------------------ invisible props

type P3 = [number, number, number]
const seg3 = (s: Segment, y: number): [P3, P3] => [[s.a.x, y, s.a.z], [s.b.x, y, s.b.z]]

/** An invisible wall, door or light source: the GM's gizmo, and the hit target. */
const MemoInvisiblePart = memo(function InvisiblePart({ prop }: { prop: Prop }) {
  const { grid, viewer, scene } = useTable()
  const gm = !viewer || viewer.isGm
  const selected = useGame((s) => s.propSelection.includes(prop.id))
  const preview = useTableUi((s) => s.propPreview?.[prop.id] ?? null)
  const [hover, setHover] = useState(false)
  const handlers = usePropPointer(() => prop.id, (id) => setHover(id !== null))
  const group = useRef<Object3D>(null)
  useEffect(() => registerPropObject(prop.id, group.current), [prop.id])
  const cell = grid.cellSize
  const position = preview?.position ?? prop.position
  const rotation = preview?.rotation ?? prop.rotation
  const scale = preview?.scale ?? propScale(prop)
  const parts = localParts(prop, undefined, cell)
  const playerDoor = !gm && !!prop.door && !!scene.playersOpenDoors && !prop.door.locked
  useCursor(hover && (gm || playerDoor), prop.door ? 'pointer' : 'grab')
  if (!gm && !playerDoor) return null

  const y = 0.06
  const color = selected ? SELECT : hover ? HOVER : prop.door ? (prop.door.locked ? BUILD.locked : prop.door.open ? BUILD.doorOpen : BUILD.door) : BUILD.wall
  const lines: { pts: [P3, P3]; dashed: boolean; width: number }[] = []
  if (parts) {
    const { whole, gap } = parts
    if (!prop.door) lines.push({ pts: seg3(whole, y), dashed: prop.wall!.blocks !== 'both', width: 3 })
    else if (gap) {
      if (prop.door.open) {
        // An open door: short posts at each end and a dashed line over the gap.
        const dx = gap.b.x - gap.a.x, dz = gap.b.z - gap.a.z
        const post = 0.12
        lines.push({ pts: seg3({ a: gap.a, b: { x: gap.a.x + dx * post, z: gap.a.z + dz * post } }, y), dashed: false, width: 5 })
        lines.push({ pts: seg3({ a: { x: gap.b.x - dx * post, z: gap.b.z - dz * post }, b: gap.b }, y), dashed: false, width: 5 })
        lines.push({ pts: seg3(gap, y), dashed: true, width: 2 })
      } else lines.push({ pts: seg3(gap, y), dashed: false, width: 5 })
    }
  }
  const len = parts ? Math.hypot(parts.whole.b.x - parts.whole.a.x, parts.whole.b.z - parts.whole.a.z) : 0
  const bulbY = 1.4 * cell
  return (
    <group ref={group} userData={{ propId: prop.id }} position={[position.x, position.y, position.z]} rotation={[0, rotation.y, 0]} {...handlers}>
      <group scale={[scale.x, 1, scale.z]}>
        {gm && lines.map((l, i) => (
          <Line key={i} points={l.pts} color={color} lineWidth={l.width} dashed={l.dashed} dashSize={0.2} gapSize={0.12}
            depthTest={false} transparent opacity={0.95} renderOrder={20} raycast={noRaycast} />
        ))}
        {!gm && hover && lines.map((l, i) => (
          <Line key={i} points={l.pts} color={HOVER} lineWidth={3} depthTest={false} transparent opacity={0.8} renderOrder={20} raycast={noRaycast} />
        ))}
        {len > 0 && (
          // The hit target: a low slab along the segment, never drawn.
          <mesh position={[0, 0.3 * cell, 0]}>
            <boxGeometry args={[len, 0.6 * cell, 0.3 * cell]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        )}
      </group>
      {gm && prop.light && !parts && (
        <group position-y={bulbY}>
          <mesh raycast={noRaycast}>
            <sphereGeometry args={[0.12 * cell, 12, 8]} />
            <meshBasicMaterial color={selected ? SELECT : prop.light.color} />
          </mesh>
          {(selected || hover) && (
            <mesh raycast={noRaycast} rotation-x={-Math.PI / 2} position-y={-bulbY + 0.02}>
              <ringGeometry args={[0.16 * cell, 0.2 * cell, 24]} />
              <meshBasicMaterial color={selected ? SELECT : HOVER} transparent opacity={0.8} depthWrite={false} />
            </mesh>
          )}
          <mesh>
            <sphereGeometry args={[0.28 * cell, 8, 6]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  )
})

// ------------------------------------------------------------------ doorway leaves

/** The swinging leaf of a doorway model (a wall with a door in it), hinged at one side of the gap. */
const MemoDoorwayLeaf = memo(function DoorwayLeaf({ prop }: { prop: Prop }) {
  const { grid } = useTable()
  const preview = useTableUi((s) => s.propPreview?.[prop.id] ?? null)
  const version = useModelBoundsVersion((s) => s.version)
  const [hover, setHover] = useState(false)
  const handlers = usePropPointer(() => prop.id, (id) => setHover(id !== null))
  useCursor(hover, 'pointer')
  const bounds = useMemo(() => { void version; return modelBoundsOf(prop) }, [prop, version])
  const parts = localParts(prop, bounds, grid.cellSize)
  if (!parts?.gap || !prop.door) return null
  const position = preview?.position ?? prop.position
  const rotation = preview?.rotation ?? prop.rotation
  const scale = preview?.scale ?? propScale(prop)
  const { gap } = parts
  const dx = gap.b.x - gap.a.x, dz = gap.b.z - gap.a.z
  const w = Math.hypot(dx, dz)
  if (w < 1e-4) return null
  const h = bounds?.top !== undefined ? bounds.top * 0.75 : 0.9 * grid.cellSize
  const t = 0.06 * grid.cellSize / Math.max(scale.z, 1e-6)
  const angle = -Math.atan2(dz, dx)
  const swing = prop.door.open ? -Math.PI * 0.45 : 0
  return (
    <group position={[position.x, position.y, position.z]} rotation={[0, rotation.y, 0]}>
      <group scale={[scale.x, scale.y, scale.z]}>
        <group position={[gap.a.x, 0, gap.a.z]} rotation-y={angle + swing}>
          <mesh position={[w / 2, h / 2, 0]} castShadow receiveShadow userData={{ propId: prop.id }} {...handlers}>
            <boxGeometry args={[w, h, t]} />
            <meshStandardMaterial color={hover ? '#a0764a' : '#6b4a2b'} roughness={0.85} />
          </mesh>
        </group>
      </group>
    </group>
  )
})
