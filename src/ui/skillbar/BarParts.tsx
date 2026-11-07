/**
 * Small visual pieces of the token bar: the HP meter (pips up to MAX_PIPS, a bar beyond, in the
 * token's HP band colour) and a skill's cost badges.
 */
import type { CSSProperties } from 'react'
import type { SkillDef } from '@/core/pack'
import { costBadges, hpMeter } from './barVisuals'
import { Icon } from '../icons'

export function HpMeter({ current, max, label }: { current: number; max: number; label: string }) {
  const m = hpMeter(current, max)
  const style = { '--hp': m.color, '--pips': m.pips } as CSSProperties
  return (
    <span className={`hp-meter hp-meter--${m.band}${m.state ? ` hp-meter--${m.state}` : ''}`} style={style} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={current} aria-valuetext={`${current} of ${max}${m.state ? `, ${m.state}` : ''}`}>
      {m.state && <Icon name={m.state === 'dead' ? 'skull' : 'bloodied'} size={14} className="hp-state" />}
      {m.mode === 'pips' ? (
        <span className="hp-pips" aria-hidden="true">
          {Array.from({ length: m.pips }, (_, i) => <i key={i} className={i < m.lit ? 'on' : undefined} />)}
        </span>
      ) : (
        <span className="hp-track" aria-hidden="true"><span className="hp-fill" style={{ width: `${m.fraction * 100}%` }} /></span>
      )}
      <span className="hp-num" aria-hidden="true">{current}/{max}</span>
    </span>
  )
}

export function CostBadges({ skill, labelOf }: { skill: Pick<SkillDef, 'cost'>; labelOf(id: string): string }) {
  const badges = costBadges(skill, labelOf)
  if (!badges.length) return <span className="cost-free">free</span>
  return (
    <span className="cost-badges">
      {badges.map((b, i) => (
        <span key={i} className="cost-badge" title={b.title}>
          {b.dots !== null
            ? <span className="cost-dots" aria-hidden="true">{Array.from({ length: b.dots }, (_, k) => <i key={k} />)}</span>
            : <span className="cost-amount">{b.amount}</span>}
          <span className="cost-tag">{b.tag}</span>
        </span>
      ))}
    </span>
  )
}
