/** `ring`: an expanding ground ring (bright edge + faint fill) with a low spray of sparks along the ground. */
import { useMemo } from 'react'
import { AdditiveBlending, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three'
import type { ScheduledEffect } from '../schedule'
import { Burst } from './Burst'
import { easeOutCubic, hexToColor, useLifetime, useResource } from './common'

export function RingEffect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const g = effect.from!.ground
  const cell = effect.cellSize
  const radius = effect.radius

  const edgeGeo = useResource(() => new RingGeometry(0.88, 1, 64))
  const fillGeo = useResource(() => new CircleGeometry(0.9, 48))
  const edgeMat = useResource(() => new MeshBasicMaterial({ color: hexToColor(effect.color), transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false }))
  const fillMat = useResource(() => new MeshBasicMaterial({ color: hexToColor(effect.color), transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false, opacity: 0.2 }))

  const group = useMemo(() => {
    const grp = new Group()
    grp.position.set(g.x, g.y + 0.02, g.z)
    grp.rotation.x = -Math.PI / 2
    const edge = new Mesh(edgeGeo, edgeMat)
    const fill = new Mesh(fillGeo, fillMat)
    fill.position.z = -0.005
    grp.add(edge, fill)
    grp.scale.setScalar(0.001)
    grp.frustumCulled = false
    edge.frustumCulled = false
    fill.frustumCulled = false
    return grp
  }, [g, edgeGeo, fillGeo, edgeMat, fillMat])

  useLifetime(effect.duration, (t) => {
    const s = Math.max(0.001, radius * easeOutCubic(t))
    group.scale.set(s, s, 1)
    edgeMat.opacity = Math.pow(1 - t, 1.5)
    fillMat.opacity = 0.22 * (1 - t)
  }, onDone)

  return (
    <>
      <primitive object={group} />
      <Burst
        center={{ x: g.x, y: g.y + 0.05 * cell, z: g.z }} color={effect.color} count={40} durationMs={effect.duration * 0.9}
        speed={(radius / (effect.duration / 1000)) * 0.9} size={cell * 0.06} gravity={0} drag={1.5} spread="disc" jitter={cell * 0.1} seed={3}
      />
    </>
  )
}
