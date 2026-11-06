/** Square or hex grid lines drawn just above the floor. */
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { GridSpec } from '@/core/geometry'
import { cellsInBounds, hexCorners, worldToCell, type Bounds2 } from './grid'

const noRaycast = () => undefined

export function buildGridGeometry(grid: GridSpec, bounds: Bounds2): BufferGeometry {
  const pts: number[] = []
  if (grid.type === 'square') {
    const s = grid.cellSize
    const c0 = worldToCell(grid, bounds.minX, bounds.minZ)
    const c1 = worldToCell(grid, bounds.maxX, bounds.maxZ)
    const x0 = grid.origin.x + (c0.q - 0.5) * s, x1 = grid.origin.x + (c1.q + 0.5) * s
    const z0 = grid.origin.z + (c0.r - 0.5) * s, z1 = grid.origin.z + (c1.r + 0.5) * s
    for (let q = c0.q; q <= c1.q + 1; q++) {
      const x = grid.origin.x + (q - 0.5) * s
      pts.push(x, 0, z0, x, 0, z1)
    }
    for (let r = c0.r; r <= c1.r + 1; r++) {
      const z = grid.origin.z + (r - 0.5) * s
      pts.push(x0, 0, z, x1, 0, z)
    }
  } else if (grid.type === 'hex') {
    const seen = new Set<string>()
    const key = (ax: number, az: number, bx: number, bz: number) => {
      const a = `${ax.toFixed(4)},${az.toFixed(4)}`, b = `${bx.toFixed(4)},${bz.toFixed(4)}`
      return a < b ? `${a}|${b}` : `${b}|${a}`
    }
    for (const cell of cellsInBounds(grid, bounds)) {
      const c = hexCorners(grid, cell)
      for (let i = 0; i < 6; i++) {
        const a = c[i]!, b = c[(i + 1) % 6]!
        const k = key(a.x, a.y, b.x, b.y)
        if (seen.has(k)) continue
        seen.add(k)
        pts.push(a.x, 0, a.y, b.x, 0, b.y)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3))
  return geo
}

export function GridOverlay({ grid, bounds, floorY }: { grid: GridSpec; bounds: Bounds2; floorY: number }) {
  const geometry = useMemo(() => buildGridGeometry(grid, bounds), [grid, bounds])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (grid.type === 'none') return null
  return (
    <lineSegments geometry={geometry} position-y={floorY + 0.012} raycast={noRaycast} renderOrder={2}>
      <lineBasicMaterial color="#e8dcc0" transparent opacity={0.22} depthWrite={false} />
    </lineSegments>
  )
}
