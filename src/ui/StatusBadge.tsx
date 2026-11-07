/**
 * A status (condition) icon in the DOM, drawn like the chips on the table: the category's border
 * shape in its colour, a monochrome glyph (or the condition's letters when the pack gives no
 * glyph), a turns-left badge when the game tracks a duration, and a pulse on the last turn.
 * Decorative unless `label` is given; callers keep the condition name in text or aria-label.
 */
import type { ConditionChip } from '@/table/tokenHud'
import { ICON_STROKE } from './icons'
import { GLYPH_INSET, GLYPHS, SHAPES } from './theme/glyphs'
import './status.css'

export function StatusBadge({ chip, size = 22, off = false, label }: { chip: ConditionChip; size?: number; off?: boolean; label?: string }) {
  const inset = (24 * (1 - GLYPH_INSET)) / 2
  const cls = ['status-badge', `status-badge--${chip.category}`, off ? 'off' : '', chip.last && !off ? 'last' : ''].filter(Boolean).join(' ')
  return (
    <span className={cls} style={{ width: size, height: size, ['--st' as string]: chip.color }} role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : true} title={label}>
      <svg viewBox="0 0 24 24" width={size} height={size} focusable="false">
        <path className="status-frame" d={SHAPES[chip.shape]} />
        {chip.glyph ? (
          <g transform={`translate(${inset} ${inset}) scale(${GLYPH_INSET})`} fill="none" stroke="currentColor"
            strokeWidth={ICON_STROKE / GLYPH_INSET} strokeLinecap="round" strokeLinejoin="round">
            {GLYPHS[chip.glyph]!.map((d) => <path key={d} d={d} />)}
          </g>
        ) : (
          <text className="status-letters" x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize={chip.label.length > 1 ? 9 : 11}>{chip.label}</text>
        )}
      </svg>
      {chip.remaining !== null && <span className="status-turns">{chip.remaining}</span>}
    </span>
  )
}
