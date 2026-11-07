/**
 * Stand-in for a model whose bytes could not be fetched from any source (not uploaded yet, upload
 * failed, every server down): an amber wireframe crate with a faint fill so it can still be
 * picked, moved and deleted. Distinct from the loading crate and from the red "broken file" crate.
 */
import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'

const MISSING = '#e0a33a'

export function MissingModel({ size, y = 0 }: { size: number; y?: number }) {
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  // The cross on the front face reads as "nothing here" at table distance.
  return (
    <group position-y={y + size / 2} scale={size}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={MISSING} />
      </lineSegments>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={MISSING} transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <mesh rotation-z={Math.PI / 4} position-z={0.501}>
        <planeGeometry args={[1.2, 0.06]} />
        <meshBasicMaterial color={MISSING} />
      </mesh>
      <mesh rotation-z={-Math.PI / 4} position-z={0.501}>
        <planeGeometry args={[1.2, 0.06]} />
        <meshBasicMaterial color={MISSING} />
      </mesh>
    </group>
  )
}
