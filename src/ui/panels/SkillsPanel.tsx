/**
 * Skills of the selected token's character as large touch buttons. Tapping one starts targeting
 * on the table (`useTargeting`); `self` skills fire at once. `useSkillTargeting` turns the pending
 * skill into the table's `targeting` prop and dispatches `skill.use` on pick.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { Character } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { TokenId } from '@/core/ids'
import type { TargetingProps } from '@/table'
import { useTargeting } from '../targeting'

const TOAST_MS = 8000

/** Current value of a resource in sheet data: a number, `{ current }`, or a dotted path. */
export function readResource(data: Record<string, unknown>, id: string): number | undefined {
  const path = id.includes('.') ? id.split('.') : [id]
  let v: unknown = data
  for (const k of path) {
    if (!v || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && typeof (v as { current?: unknown }).current === 'number') return (v as { current: number }).current
  return undefined
}

/** Why a skill cannot be used right now, or null when it can. `amounts` holds evaluated cost expressions. */
export function skillShortfall(skill: SkillDef, character: Character, amounts: Record<string, number>, labelOf: (id: string) => string): string | null {
  for (const [i, cost] of (skill.cost ?? []).entries()) {
    const amount = amounts[`${skill.id}:${i}`]
    if (amount === undefined) continue // still evaluating; do not block
    const current = readResource(character.data, cost.resource)
    if (current === undefined) return `no ${labelOf(cost.resource)}`
    if (current < amount) return `needs ${amount} ${labelOf(cost.resource)} (${current})`
  }
  return null
}

function costLabel(skill: SkillDef, labelOf: (id: string) => string): string {
  if (!skill.cost?.length) return 'free'
  return skill.cost.map((c) => `${c.amount} ${labelOf(c.resource)}`).join(', ')
}

function shapeLabel(skill: SkillDef): string {
  const t = skill.target
  switch (t.kind) {
    case 'self': return 'self'
    case 'single': return `single · range ${t.range}`
    case 'radius': return `burst ${t.radius} · range ${t.range}`
    case 'cone': return `cone ${t.angle}° · ${t.range}`
    case 'line': return `line ${t.width} · ${t.range}`
  }
}

export function SkillsPanel({ controller }: { controller: GameController }) {
  const selected = useGame((s) => s.selectedToken)
  const token = useGame((s) => (selected ? s.tokens[selected] : undefined))
  const character = useGame((s) => (token?.character ? s.characters[token.character] : undefined))
  const chat = useGame((s) => s.chat)
  const pending = useTargeting((s) => s.pending)
  const firedAt = useTargeting((s) => s.firedAt)
  const rules = controller.rules
  const isGm = controller.connection.isGm
  const mayUse = isGm || (token?.owner === controller.pubkey)

  const labelOf = useMemo(() => (id: string) => rules?.pack.resources.find((r) => r.id === id)?.name ?? rules?.pack.attributes.find((a) => a.id === id)?.abbr ?? id, [rules])

  // Evaluate non-numeric cost expressions against the sheet (most are literals).
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!rules || !character) { setAmounts({}); return }
    let live = true
    const next: Record<string, number> = {}
    const pendingEvals: Promise<void>[] = []
    for (const skill of rules.pack.skills) {
      for (const [i, cost] of (skill.cost ?? []).entries()) {
        const key = `${skill.id}:${i}`
        const n = Number(cost.amount)
        if (cost.amount.trim() !== '' && Number.isFinite(n)) { next[key] = n; continue }
        pendingEvals.push(rules.evaluate(cost.amount, character).then((v) => { if (typeof v === 'number') next[key] = v }, () => {}))
      }
    }
    setAmounts({ ...next })
    if (pendingEvals.length) void Promise.all(pendingEvals).then(() => { if (live) setAmounts({ ...next }) })
    return () => { live = false }
  }, [rules, character])

  // Outcome line: system messages the GM appended since the last skill fired.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!firedAt) return
    setNow(Date.now())
    const t = setTimeout(() => setNow(Date.now()), TOAST_MS + 50)
    return () => clearTimeout(t)
  }, [firedAt, chat.length])
  const outcome = useMemo(() => {
    if (!firedAt || now - firedAt > TOAST_MS) return []
    return chat.filter((m) => m.kind === 'system' && m.at >= firedAt).slice(-3)
  }, [chat, firedAt, now])

  if (!rules) return null
  const skills = rules.pack.skills
  if (skills.length === 0) return null

  const use = (skill: SkillDef) => {
    if (!token || !character) return
    if (pending?.skillId === skill.id && pending.source === token.id) { useTargeting.getState().clear(); return }
    if (skill.target.kind === 'self') {
      useTargeting.getState().clear()
      useTargeting.getState().markFired()
      void controller.dispatch({ type: 'skill.use', skill: skill.id, source: token.id, targets: [token.id], seed: newSeed() })
      return
    }
    useTargeting.getState().start({ skillId: skill.id, name: skill.name, source: token.id as TokenId, shape: skill.target })
  }

  const list: CSSProperties = { display: 'grid', gap: 8 }
  const btn = (active: boolean, disabled: boolean): CSSProperties => ({
    display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 10, rowGap: 2, alignItems: 'center', textAlign: 'left',
    minHeight: 56, padding: '8px 12px', borderRadius: 10, width: '100%',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(224,164,88,0.16)' : disabled ? '#1c1c21' : '#26262d',
    opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer', touchAction: 'manipulation',
  })

  return (
    <div className="panel">
      <h3>
        Skills
        {pending && <button className="tiny" onClick={() => useTargeting.getState().clear()}>Cancel</button>}
      </h3>
      {!token && <p className="muted small">Select a token.</p>}
      {token && !character && <p className="muted small">{token.name} has no character sheet.</p>}
      {token && character && !mayUse && <p className="muted small">You do not control {token.name}.</p>}
      {pending && (
        <p className="small" style={{ color: 'var(--accent)', margin: '0 0 8px' }}>
          Aiming {pending.name}: tap the table to pick, tap the caster or press Esc to cancel.
        </p>
      )}
      {token && character && mayUse && (
        <div style={list}>
          {skills.map((skill) => {
            const reason = skillShortfall(skill, character, amounts, labelOf)
            const disabled = reason !== null
            const active = pending?.skillId === skill.id && pending.source === token.id
            return (
              <button key={skill.id} type="button" style={btn(active, disabled)} disabled={disabled} onClick={() => use(skill)} aria-pressed={active} title={skill.description}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{skill.name}</span>
                <span className="small" style={{ color: disabled ? '#ff9b8f' : 'var(--accent)', whiteSpace: 'nowrap' }}>{reason ?? costLabel(skill, labelOf)}</span>
                <span className="muted small" style={{ gridColumn: '1 / -1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shapeLabel(skill)} — {skill.description}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {outcome.length > 0 && (
        <div className="small" style={{ marginTop: 8, padding: '6px 8px', borderRadius: 8, background: '#101014', borderLeft: '3px solid var(--accent)' }}>
          {outcome.map((m) => <div key={m.id}>{m.text}</div>)}
        </div>
      )}
    </div>
  )
}

/** The table's `targeting` prop for the pending skill; dispatches `skill.use` when a target is picked. */
export function useSkillTargeting(controller: GameController | null): TargetingProps | undefined {
  const pending = useTargeting((s) => s.pending)
  const sourceExists = useGame((s) => (pending ? !!s.tokens[pending.source] : true))
  useEffect(() => { if (pending && !sourceExists) useTargeting.getState().clear() }, [pending, sourceExists])
  return useMemo<TargetingProps | undefined>(() => {
    if (!pending || !controller) return undefined
    return {
      shape: pending.shape,
      source: pending.source,
      onPick: ({ targets, point }) => {
        const t = useTargeting.getState()
        t.markFired()
        t.clear()
        void controller.dispatch({ type: 'skill.use', skill: pending.skillId, source: pending.source, targets, point, seed: newSeed() })
      },
      onCancel: () => useTargeting.getState().clear(),
    }
  }, [pending, controller])
}
