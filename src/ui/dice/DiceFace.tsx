/**
 * Small drawn dice for a roll: a d6 shows pips, other dice a rough polygon with the value and a tiny
 * "d20" caption. Dropped dice (kh/kl) are faded and struck; natural max/min get a highlight ring.
 * Purely visual: callers give the spoken result (see `rollSummary`).
 */
import { dieShape, pipCells, pipPoint, shapePoints, type DieView } from './diceFaces'
import { GLYPHS } from '../theme/glyphs'
import './DiceFace.css'

export function DieFace({ die }: { die: DieView }) {
  const shape = dieShape(die.sides, die.value)
  const points = shapePoints(shape)
  const cls = ['die-face', `die-${shape}`, die.kept ? '' : 'die dropped', die.max ? 'nat-max' : '', die.min ? 'nat-min' : ''].filter(Boolean).join(' ')
  const big = String(die.value).length > 2
  return (
    <span className={cls}>
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false">
        {points ? <polygon className="die-body" points={points} /> : <rect className="die-body" x="2" y="2" width="28" height="28" rx={shape === 'pips' ? 6 : 12} />}
        {shape === 'pips'
          ? pipCells(die.value)!.map((c) => { const p = pipPoint(c); return <circle key={c} className="die-pip" cx={p.x} cy={p.y} r="2.7" /> })
          : <text className="die-num" x="16" y={shape === 'triangle' ? 23 : 16.5} textAnchor="middle" dominantBaseline="central" fontSize={big ? 9.5 : shape === 'triangle' ? 11 : 13}>{die.value}</text>}
        {!die.kept && <line className="die-strike" x1="4" y1="28" x2="28" y2="4" />}
        {/* Natural max / 1 also get a shape, not just a colour: a star or a broken ring on the corner. */}
        {die.kept && (die.max || die.min) && (
          <g className="die-mark" transform="translate(19 -5) scale(0.6)">
            <circle cx="12" cy="12" r="11" />
            {GLYPHS[die.max ? 'crit' : 'fumble']!.map((d) => <path key={d} d={d} />)}
          </g>
        )}
      </svg>
      {shape !== 'pips' && die.sides !== undefined && <span className="die-sides">d{die.sides}</span>}
    </span>
  )
}

/** A wrapping row of dice faces. */
export function DiceRow({ dice, className }: { dice: DieView[]; className?: string }) {
  return (
    <span className={['dice-row', className ?? ''].filter(Boolean).join(' ')} aria-hidden="true">
      {dice.map((d, i) => <DieFace key={i} die={d} />)}
    </span>
  )
}
