/**
 * Draws the open tooltips (tips.ts) over everything, mounted once in the HUD. Level 1 explains a
 * skill (icon, cost, an animated picture of its shape, the description) or a status (badge, what
 * it does, its modifiers); level 2 explains a glossary term opened from a link in level 1. Links
 * only appear at level 1, so tips nest two deep at most.
 *
 * Pinned tips are dialogs with a close button; Esc closes the top one and hands focus back to
 * whatever opened it; a press anywhere outside the tips and their opener closes them all.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { SkillDef } from '@/core/pack'
import type { TargetShape } from '@/core/geometry'
import { useSession } from '../session'
import { Icon } from '../icons'
import { CostBadges } from '../skillbar/BarParts'
import { conditionStyle } from '../skillbar/barVisuals'
import { SkillIcon } from '../skillbar/skillIcons'
import { buildGlossary, linkTerms, type Glossary } from './glossary'
import { ShapePreview } from './ShapePreview'
import { placeTip, rectOf, tipDispatch, useTips, type Tip, type TipContent } from './tips'
import { focusTopTip, hideTipSoon, keepTip } from './useTipTrigger'
import './tips.css'

/** One line on what the shape covers, with the real numbers. */
export function shapeLine(shape: TargetShape): string {
  switch (shape.kind) {
    case 'self': return 'Targets yourself'
    case 'single': return `One target · range ${shape.range} ${shape.range === 1 ? 'cell' : 'cells'}`
    case 'radius': return `${shape.radius}-cell burst · range ${shape.range}`
    case 'cone': return `${shape.range}-cell cone · ${shape.angle}°`
    case 'line': return `${shape.range}-cell line · ${shape.width} wide`
  }
}

export function TipLayer() {
  const stack = useTips((s) => s.stack)
  const rules = useSession().controller?.rules ?? null
  const glossary = useMemo(() => buildGlossary(rules?.pack), [rules])
  const pinned = stack.some((t) => t.pinned)

  // Esc closes the top level (before the table's Esc deselects); a press outside closes them all.
  useEffect(() => {
    if (!stack.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      const top = useTips.getState().stack.at(-1)
      tipDispatch({ type: 'closeTop' })
      if (top?.opener?.isConnected) top.opener.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [stack.length])
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('.tip-card')) return
      if (useTips.getState().stack.some((tip) => tip.opener?.contains(t))) return
      tipDispatch({ type: 'closeAll' })
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [pinned])

  if (!stack.length) return null
  return (
    <>
      {stack.map((tip, level) => (
        <TipCard key={`${level}:${JSON.stringify(tip.content)}`} tip={tip} level={level} glossary={glossary} />
      ))}
    </>
  )
}

function TipCard({ tip, level, glossary }: { tip: Tip; level: number; glossary: Glossary }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(placeTip(tip.anchor, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }))
  }, [tip.anchor])
  const title = useTipTitle(tip.content, glossary)
  const style: CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }
  const nest = (id: string, el: HTMLElement) => {
    tipDispatch({ type: 'nest', tip: { content: { kind: 'term', id }, anchor: rectOf(el), opener: el } })
    focusTopTip()
  }
  return (
    <div
      ref={ref}
      className={`tip-card tip-card--l${level + 1}${tip.pinned ? ' pinned' : ''}`}
      role={tip.pinned ? 'dialog' : 'tooltip'}
      aria-label={title}
      id={`tip-${level + 1}`}
      tabIndex={-1}
      style={style}
      onPointerEnter={keepTip}
      onPointerLeave={(e) => { if (!tip.pinned && e.pointerType !== 'touch') hideTipSoon() }}
      onPointerDown={() => { if (!tip.pinned) tipDispatch({ type: 'pinTop' }) }}
    >
      {tip.pinned && (
        <button type="button" className="icon tip-close" aria-label={`Close ${title}`} onClick={() => {
          tipDispatch({ type: 'closeTop' })
          if (tip.opener?.isConnected && level > 0) tip.opener.focus()
        }}><Icon name="close" /></button>
      )}
      <TipBody content={tip.content} glossary={glossary} links={level === 0} onTerm={nest} />
      {!tip.pinned && <div className="tip-hint muted">Tap to pin</div>}
    </div>
  )
}

function useTipTitle(content: TipContent, glossary: Glossary): string {
  const rules = useSession().controller?.rules ?? null
  switch (content.kind) {
    case 'skill': return rules?.allSkills().find((s) => s.id === content.skill)?.name ?? 'Skill'
    case 'condition': return rules?.pack.conditions.find((c) => c.id === content.condition)?.name ?? content.condition
    case 'term': return glossary.entries.get(content.id)?.term ?? 'Term'
  }
}

/** Text with glossary mentions: buttons that open the term (level 1), or just emphasised (level 2). */
function Linked({ text, glossary, skip, links, onTerm }: { text: string; glossary: Glossary; skip?: string; links: boolean; onTerm(id: string, el: HTMLElement): void }) {
  const parts = linkTerms(text, glossary, skip)
  return (
    <p className="tip-text">
      {parts.map((p, i) => !p.id ? <span key={i}>{p.text}</span>
        : links ? <button key={i} type="button" className="tip-term" onClick={(e) => onTerm(p.id!, e.currentTarget)}>{p.text}</button>
        : <em key={i} className="tip-term-plain">{p.text}</em>)}
    </p>
  )
}

function TipBody({ content, glossary, links, onTerm }: { content: TipContent; glossary: Glossary; links: boolean; onTerm(id: string, el: HTMLElement): void }) {
  const controller = useSession().controller
  const rules = controller?.rules ?? null
  const labelOf = useMemo(() => (id: string) => rules?.pack.resources.find((r) => r.id === id)?.name ?? rules?.pack.attributes.find((a) => a.id === id)?.abbr ?? id, [rules])
  switch (content.kind) {
    case 'skill': {
      const skill: SkillDef | undefined = rules?.allSkills().find((s) => s.id === content.skill)
      if (!skill) return <p className="tip-text muted">This skill is no longer available.</p>
      const line = shapeLine(skill.target)
      return (
        <>
          <div className="tip-head">
            <SkillIcon icon={skill.icon} kind={skill.target.kind} />
            <strong className="tip-title">{skill.name}</strong>
            <span className="tip-cost"><CostBadges skill={skill} labelOf={labelOf} /></span>
          </div>
          <div className="tip-shape">
            <ShapePreview shape={skill.target} label={`${line}: picture of the area`} />
            <span className="tip-shape-line">{line}</span>
          </div>
          {skill.description && <Linked text={skill.description} glossary={glossary} links={links} onTerm={onTerm} />}
          {content.reason && <p className="tip-reason">Can't use now: {content.reason}</p>}
        </>
      )
    }
    case 'condition': {
      const defs = rules?.pack.conditions ?? []
      const def = defs.find((c) => c.id === content.condition)
      const { color, label } = conditionStyle(defs, content.condition)
      const attr = (k: string) => { const a = rules?.pack.attributes.find((x) => x.id === k); return a?.abbr ?? a?.name ?? k }
      // Packs zero a stat with a huge negative modifier (speed −1000): say so instead of printing the number.
      const mods = Object.entries(def?.modifiers ?? {}).filter(([, v]) => v !== 0)
        .map(([k, v]) => (v <= -1000 ? `${attr(k)} to 0` : `${attr(k)} ${v > 0 ? '+' : '−'}${Math.abs(v)}`))
      return (
        <>
          <div className="tip-head">
            <span className="condition-chip-badge tip-badge" style={{ '--cond': color } as CSSProperties} aria-hidden="true">{label}</span>
            <strong className="tip-title">{def?.name ?? content.condition}</strong>
            <span className="tip-kind muted">status</span>
          </div>
          <Linked text={def?.description ?? 'A status the GM set on this token.'} glossary={glossary} skip={`condition:${content.condition}`} links={links} onTerm={onTerm} />
          {mods.length > 0 && <p className="tip-mods">{mods.join(' · ')}</p>}
        </>
      )
    }
    case 'term': {
      const entry = glossary.entries.get(content.id)
      return (
        <>
          <div className="tip-head">
            <strong className="tip-title">{entry?.term ?? 'Unknown term'}</strong>
            <span className="tip-kind muted">{entry?.kind === 'condition' ? 'status' : entry?.kind === 'resource' ? 'resource' : 'rules'}</span>
          </div>
          {entry && <Linked text={entry.text} glossary={glossary} skip={entry.id} links={links} onTerm={onTerm} />}
        </>
      )
    }
  }
}
