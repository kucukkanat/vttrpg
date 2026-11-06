/**
 * 3D dice that tumble into a tray and end up showing predetermined values.
 *
 * Mounts inside any `<Canvas>` (the table's, or `DiceTrayOverlay`'s own). It needs no
 * `<Physics>` provider: when `rollId` changes the throw is pre-simulated in a private Rapier
 * world (see `simulate.ts` for the why), the committed values are mapped onto the final
 * poses with symmetry offsets, and the recording is played back here as plain mesh poses.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Mesh, Quaternion, Vector3 } from 'three'
import { colorsFor, dieMaterial, type DiceColorScheme } from './atlas'
import { buildDieGeometry, dieDef, toPhysicalDice, type DieType } from './geometry'
import { samplePose, simulateRoll, type RollRecording } from './simulate'

export interface DiceTrayProps {
  /** Dice to roll with their predetermined results. Changing `rollId` triggers a new roll; `null` clears the tray. */
  rollId: string | null
  dice: { sides: number; value: number }[]
  /** Fired once per roll when every die rests. */
  onSettled?(rollId: string): void
  /** Fired on die collisions, strength in [0, 1] (floor, walls and other dice). */
  onImpact?(strength: number): void
  /** Tray centre in the parent's space; the floor is at y = 0 of this group. */
  position?: [number, number, number]
  /** Inner tray size [width, depth] in world units. Default [8, 5]. */
  size?: [number, number]
  /** Circumradius of a die in world units. Default 0.5. */
  dieSize?: number
  colorScheme?: DiceColorScheme
  /** Draw the rim. Default true. */
  showRim?: boolean
  /** Floor rendering: solid wood-like plane, shadow-only (for HUD overlays) or nothing. Default 'solid'. */
  floor?: 'solid' | 'shadow' | 'none'
  /** Dice cast and receive shadows. Default true. */
  shadows?: boolean
}

const geometries = new Map<DieType, BufferGeometry>()
function geometryFor(type: DieType): BufferGeometry {
  let g = geometries.get(type)
  if (!g) geometries.set(type, (g = buildDieGeometry(dieDef(type))))
  return g
}

interface ActiveRoll {
  id: string
  rec: RollRecording
  start: number | null
  nextImpact: number
  settled: boolean
}

export function DiceTray({
  rollId,
  dice,
  onSettled,
  onImpact,
  position = [0, 0, 0],
  size = [8, 5],
  dieSize = 0.5,
  colorScheme,
  showRim = true,
  floor = 'solid',
  shadows = true,
}: DiceTrayProps) {
  const [width, depth] = size
  const [roll, setRoll] = useState<ActiveRoll | null>(null)
  const meshes = useRef<(Mesh | null)[]>([])
  const latest = useRef({ dice, onSettled, onImpact })
  latest.current = { dice, onSettled, onImpact }

  useEffect(() => {
    if (!rollId) { setRoll(null); return }
    let cancelled = false
    const physical = toPhysicalDice(latest.current.dice)
    simulateRoll({ seed: rollId, dice: physical, dieSize, tray: { width, depth } }).then((rec) => {
      if (!cancelled) setRoll({ id: rollId, rec, start: null, nextImpact: 0, settled: false })
    })
    return () => { cancelled = true }
  }, [rollId, dieSize, width, depth])

  const tmpPos = useMemo(() => new Vector3(), [])
  const tmpRot = useMemo(() => new Quaternion(), [])

  useFrame(({ clock }) => {
    if (!roll) return
    const now = clock.elapsedTime
    if (roll.start === null) roll.start = now
    const t = now - roll.start
    const { rec } = roll
    rec.tracks.forEach((track, i) => {
      const m = meshes.current[i]
      if (!m) return
      samplePose(rec, track, t, tmpPos, tmpRot)
      m.position.copy(tmpPos)
      m.quaternion.copy(tmpRot)
    })
    const impacts = rec.impacts
    while (roll.nextImpact < impacts.length && impacts[roll.nextImpact].step * rec.dt <= t) {
      latest.current.onImpact?.(impacts[roll.nextImpact].strength)
      roll.nextImpact++
    }
    if (!roll.settled && t >= rec.duration) {
      roll.settled = true
      latest.current.onSettled?.(roll.id)
    }
  })

  const rimH = dieSize * 0.7, rimT = dieSize * 0.35
  return (
    <group position={position}>
      {floor !== 'none' && (
        <mesh rotation-x={-Math.PI / 2} receiveShadow={shadows} position-y={0.001}>
          <planeGeometry args={[width + rimT * 2, depth + rimT * 2]} />
          {floor === 'solid' ? (
            <meshStandardMaterial color="#2f2520" roughness={0.9} />
          ) : (
            <shadowMaterial transparent opacity={0.35} />
          )}
        </mesh>
      )}
      {showRim && (
        <group>
          {[
            [0, -depth / 2 - rimT / 2, width + rimT * 2, rimT],
            [0, depth / 2 + rimT / 2, width + rimT * 2, rimT],
            [-width / 2 - rimT / 2, 0, rimT, depth],
            [width / 2 + rimT / 2, 0, rimT, depth],
          ].map(([x, z, w, d], i) => (
            <mesh key={i} position={[x, rimH / 2, z]} castShadow={shadows} receiveShadow={shadows}>
              <boxGeometry args={[w, rimH, d]} />
              <meshStandardMaterial color="#5a3f2e" roughness={0.75} />
            </mesh>
          ))}
        </group>
      )}
      {roll?.rec.tracks.map((track, i) => (
        <mesh
          key={`${roll.id}:${i}`}
          ref={(m) => { meshes.current[i] = m }}
          geometry={geometryFor(track.die.type)}
          material={dieMaterial(track.die.type, colorsFor(colorScheme, track.die.type))}
          scale={dieSize}
          castShadow={shadows}
          receiveShadow={shadows}
          position={[track.positions[0], track.positions[1], track.positions[2]]}
          quaternion={[track.rotations[0], track.rotations[1], track.rotations[2], track.rotations[3]]}
        />
      ))}
    </group>
  )
}
