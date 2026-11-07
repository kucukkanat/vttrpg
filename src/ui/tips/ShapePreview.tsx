/**
 * A small animated picture of what a skill's target shape covers, for the skill tooltip: a 7×7
 * grid with the caster near the bottom, the cells the shape would hit (computed with the table's
 * own targeting maths, so the picture agrees with the real preview) and a loop that shows the
 * effect travelling: a dart to the target, a burst blooming, a cone or line sweeping out. Plain SVG
 * and CSS; reduced motion shows the same picture without the loop. Big shapes are drawn shrunk to
 * fit; the tooltip's text carries the real numbers.
 */
import type { CSSProperties } from 'react'
import type { GridSpec, TargetShape } from '@/core/geometry'
import { cellsInShape, resolveShape } from '@/table/targeting'

const N = 7
const CELL = 10
const HALF = (N - 1) / 2
/** The caster's cell, bottom middle, in grid units (y grows downwards on screen and on the floor). */
const CASTER = { x: 0, y: 2 }
const GRID: GridSpec = { type: 'square', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }

/** The shape shrunk to the picture: ranges up to 4 cells, bursts up to 2, cones and lines from the caster. */
export function previewShape(shape: TargetShape): TargetShape {
  switch (shape.kind) {
    case 'self': return shape
    case 'single': return { kind: 'single', range: Math.min(shape.range, 4) }
    case 'radius': return { kind: 'radius', radius: Math.min(shape.radius, 2), range: Math.min(shape.range, 4) }
    case 'cone': return { kind: 'cone', range: Math.min(shape.range, 4), angle: shape.angle }
    case 'line': return { kind: 'line', range: Math.min(shape.range, 4), width: Math.min(shape.width, 2) }
  }
}

/** Where the picture aims: straight up from the caster, as far as the (shrunk) range allows. */
export function previewAim(shape: TargetShape): { x: number; y: number } {
  if (shape.kind === 'self') return CASTER
  const reach = shape.kind === 'radius' ? Math.min(shape.range, 3) : Math.min(shape.range, 4)
  return { x: CASTER.x, y: CASTER.y - Math.max(1, reach) }
}

/** Cells (grid units, origin at the picture's centre) the shrunk shape covers, inside the picture. */
export function previewCells(shape: TargetShape): { q: number; r: number }[] {
  const s = previewShape(shape)
  if (s.kind === 'self') return [{ q: CASTER.x, r: CASTER.y }]
  const aim = previewAim(s)
  if (s.kind === 'single') return [{ q: aim.x, r: aim.y }]
  const resolved = resolveShape(GRID, s, CASTER, aim, -Math.PI / 2)
  return cellsInShape(GRID, resolved).filter((c) => Math.abs(c.q) <= HALF && Math.abs(c.r) <= HALF && !(c.q === CASTER.x && c.r === CASTER.y))
}

const px = (v: number) => (v + HALF) * CELL + CELL / 2

export function ShapePreview({ shape, label }: { shape: TargetShape; label: string }) {
  const s = previewShape(shape)
  const cells = previewCells(s)
  const aim = previewAim(s)
  const cx = px(CASTER.x)
  const cy = px(CASTER.y)
  const size = N * CELL
  return (
    <svg className={`shape-preview shape-preview--${s.kind}`} viewBox={`0 0 ${size} ${size}`} width={size * 1.6} height={size * 1.6} role="img" aria-label={label}>
      <g className="sp-grid">
        {Array.from({ length: N * N }, (_, i) => <rect key={i} x={(i % N) * CELL + 0.5} y={Math.floor(i / N) * CELL + 0.5} width={CELL - 1} height={CELL - 1} rx={1.5} />)}
      </g>
      <g className="sp-area" style={{ transformOrigin: s.kind === 'radius' ? `${px(aim.x)}px ${px(aim.y)}px` : `${cx}px ${cy}px` }}>
        {cells.map((c) => <rect key={`${c.q},${c.r}`} x={px(c.q) - CELL / 2 + 0.5} y={px(c.r) - CELL / 2 + 0.5} width={CELL - 1} height={CELL - 1} rx={1.5} />)}
      </g>
      {s.kind === 'single' && <circle className="sp-dart" cx={cx} cy={cy} r={2} style={{ '--dy': `${px(aim.y) - cy}px` } as CSSProperties} />}
      {s.kind === 'self' && <circle className="sp-aura" cx={cx} cy={cy} r={CELL * 0.9} />}
      <circle className="sp-caster" cx={cx} cy={cy} r={CELL * 0.32} />
    </svg>
  )
}
