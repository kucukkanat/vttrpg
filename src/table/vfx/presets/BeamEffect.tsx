/** `beam`: a bright core line inside a soft glow tube from source to target, fading over the duration. */
import { useMemo } from 'react'
import { AdditiveBlending, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three'
import { aimPoint, type ScheduledEffect } from '../schedule'
import { Flash } from './Flash'
import { hexToColor, useLifetime, useResource } from './common'

const UP = new Vector3(0, 1, 0)

export function BeamEffect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const cell = effect.cellSize
  const a = effect.from!.chest
  const b = aimPoint(effect.to!, cell)

  const geo = useResource(() => new CylinderGeometry(1, 1, 1, 10, 1, true))
  // The core reads whiter than the glow so the beam has a hot center.
  const coreMat = useResource(() => new MeshBasicMaterial({ color: hexToColor(effect.color).lerp(hexToColor('#ffffff'), 0.55), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }))
  const glowMat = useResource(() => new MeshBasicMaterial({ color: hexToColor(effect.color), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, opacity: 0.35 }))

  const { group, core, glow } = useMemo(() => {
    const from = new Vector3(a.x, a.y, a.z)
    const to = new Vector3(b.x, b.y, b.z)
    const dir = to.clone().sub(from)
    const len = Math.max(0.01, dir.length())
    const grp = new Group()
    grp.position.copy(from).add(to).multiplyScalar(0.5)
    grp.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir.normalize()))
    const core = new Mesh(geo, coreMat)
    core.scale.set(cell * 0.03, len, cell * 0.03)
    const glow = new Mesh(geo, glowMat)
    glow.scale.set(cell * 0.1, len, cell * 0.1)
    core.frustumCulled = glow.frustumCulled = false
    grp.add(core, glow)
    return { group: grp, core, glow }
  }, [a, b, geo, coreMat, glowMat, cell])

  useLifetime(effect.duration, (t, elapsed) => {
    const fade = Math.pow(1 - t, 1.3)
    coreMat.opacity = fade
    glowMat.opacity = 0.35 * fade
    const pulse = 1 + 0.25 * Math.sin(elapsed * 42)
    core.scale.x = core.scale.z = cell * 0.03 * pulse
    glow.scale.x = glow.scale.z = cell * 0.1 * (2 - pulse)
  }, onDone)

  return (
    <>
      <primitive object={group} />
      <Flash center={b} color={effect.color} size={cell * 0.7} durationMs={Math.min(220, effect.duration)} intensity={0.9} />
      <Flash center={a} color={effect.color} size={cell * 0.4} durationMs={Math.min(160, effect.duration)} intensity={0.6} />
    </>
  )
}
