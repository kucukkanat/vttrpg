/**
 * `hit`: a burst of sparks, a bright flash at the target's chest and a quick ring on the ground
 * under it, so a hit reads from a zoomed-out phone camera too.
 */
import { useMemo } from 'react'
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry } from 'three'
import type { ScheduledEffect } from '../schedule'
import { Burst } from './Burst'
import { easeOutCubic, hexToColor, useLifetime, useResource } from './common'
import { Flash } from './Flash'

/** Flash diameter and ground ring radius, in cells. */
export const HIT_FLASH_CELLS = 1.6
export const HIT_RING_CELLS = 0.75

export function HitEffect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const c = effect.from!.chest
  const cell = effect.cellSize
  return (
    <>
      <Burst center={c} color={effect.color} count={56} durationMs={effect.duration} speed={cell * 2.6} size={cell * 0.1} gravity={cell * 3} drag={3} jitter={cell * 0.18} onDone={onDone} />
      <Flash center={c} color={effect.color} size={cell * HIT_FLASH_CELLS} intensity={1.2} durationMs={Math.min(240, effect.duration * 0.8)} />
      <GroundRing effect={effect} />
    </>
  )
}

/** A thin ring that snaps out from the target's feet and fades. */
function GroundRing({ effect }: { effect: ScheduledEffect }) {
  const g = effect.from!.ground
  const radius = HIT_RING_CELLS * effect.cellSize
  const geo = useResource(() => new RingGeometry(0.82, 1, 48))
  const mat = useResource(() => new MeshBasicMaterial({ color: hexToColor(effect.color), transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false }))
  const mesh = useMemo(() => {
    const m = new Mesh(geo, mat)
    m.position.set(g.x, g.y + 0.03, g.z)
    m.rotation.x = -Math.PI / 2
    m.scale.setScalar(0.001)
    m.renderOrder = 9
    m.frustumCulled = false
    return m
  }, [geo, mat, g])
  useLifetime(Math.max(200, effect.duration), (t) => {
    const s = Math.max(0.001, radius * (0.35 + 0.65 * easeOutCubic(t)))
    mesh.scale.set(s, s, 1)
    mat.opacity = 0.9 * (1 - t) * (1 - t)
  }, () => {})
  return <primitive object={mesh} />
}
