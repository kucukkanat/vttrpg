/** The player's owner shape as a small inline SVG (nameplates, the Players panel). No three.js. */
import { shapePoints, type OwnerShape } from './ownerShape'
import { INK } from '@/ui/theme/palette'

export function OwnerShapeGlyph({ shape, color, size = 12, title }: { shape: OwnerShape; color: string; size?: number; title?: string }) {
  const pts = shapePoints(shape)
  const common = { fill: color, stroke: INK, strokeWidth: 0.25, strokeLinejoin: 'round' as const }
  return (
    <svg className="owner-shape" viewBox="-1.3 -1.3 2.6 2.6" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle' }}>
      {pts ? <polygon points={pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')} {...common} /> : <circle r={1} {...common} />}
    </svg>
  )
}
