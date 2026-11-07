/**
 * The reach of a skill chip the viewer is pointing at (`useTableUi().previewRange`, written by the
 * token bar on hover, focus or a held finger): a flat ring of `cells` around the source token on
 * the floor, with a faint fill, plus a ring on the token itself. A `self` skill (0 cells) shows the
 * token ring only. Draws nothing when the token is not in the shown scene. Never takes pointer events.
 */
import { DoubleSide } from 'three'
import { useGame } from '@/state/store'
import { useTable } from './context'
import { useTableUi } from './tableState'
import { MEASURE } from '@/ui/theme/palette'

const COLOR = MEASURE
const noRaycast = () => undefined

export function RangePreview() {
  const preview = useTableUi((s) => s.previewRange)
  const token = useGame((s) => (preview ? s.tokens[preview.source] : undefined))
  const { grid, floorY, sceneId } = useTable()
  if (!preview || !token || token.scene !== sceneId) return null

  const y = floorY + 0.025
  const { x, z } = token.position
  const reach = preview.cells * grid.cellSize
  const edge = Math.max(0.04 * grid.cellSize, Math.min(0.08 * grid.cellSize, reach * 0.02))
  const tokenR = 0.5 * grid.cellSize * (token.scale || 1)

  return (
    <group position={[x, y, z]}>
      {reach > 0 && (
        <>
          <mesh rotation-x={-Math.PI / 2} raycast={noRaycast} renderOrder={4}>
            <circleGeometry args={[reach, 96]} />
            <meshBasicMaterial color={COLOR} transparent opacity={0.08} depthWrite={false} side={DoubleSide} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.004} raycast={noRaycast} renderOrder={5}>
            <ringGeometry args={[Math.max(0, reach - edge), reach, 96]} />
            <meshBasicMaterial color={COLOR} transparent opacity={0.75} depthWrite={false} side={DoubleSide} />
          </mesh>
        </>
      )}
      <mesh rotation-x={-Math.PI / 2} position-y={0.008} raycast={noRaycast} renderOrder={5}>
        <ringGeometry args={[tokenR * 0.9, tokenR * 1.05, 48]} />
        <meshBasicMaterial color={COLOR} transparent opacity={0.9} depthWrite={false} side={DoubleSide} />
      </mesh>
    </group>
  )
}
