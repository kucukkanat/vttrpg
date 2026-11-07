/**
 * Skills of the selected token's character as large touch buttons. Tapping one starts targeting
 * on the table (`useTargeting`); `self` skills fire at once. `useSkillTargeting` turns the pending
 * skill into the table's `targeting` prop and dispatches `skill.use` on pick.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { GameController } from '../controller'
import { useEffectiveToken, useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { Character } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { TargetingProps } from '@/table'
import { isPlayerCharacter, useTargeting } from '../targeting'
import { costLabel, useSkillCasting } from '../skillbar/useSkillCasting'
import { pushToast } from '../toasts'

const TOAST_MS = 8000
/** Longest outcome toast; beyond this only the first line is shown. */
export const OUTCOME_TOAST_MAX = 140

/** The engine's own effect lines (`takes N damage`, `recovers N`, `is now`, `is no longer`), the part of a result that matters most. */
const EFFECT_LINE = /\b(takes \d+ damage|would recover|recovers \d+|is now|is no longer)\b/

/**
 * One line for the outcome toast: the first result line, with the first effect line (or the last
 * line) appended when the cast produced several and both fit: "Pip attacks Rat. Rat takes 3 damage".
 */
export function outcomeToastText(lines: readonly string[]): string {
  const first = lines[0]?.trim() ?? ''
  const rest = lines.slice(1).map((l) => l.trim()).filter(Boolean)
  const second = rest.find((l) => EFFECT_LINE.test(l)) ?? rest[rest.length - 1] ?? ''
  if (!second) return first
  const both = `${first} ${second}`
  return both.length <= OUTCOME_TOAST_MAX ? both : first
}

/** The Chat panel is mounted somewhere on screen (desktop column, open drawer or sheet). */
function chatVisible(): boolean {
  return typeof document !== 'undefined' && document.querySelector('.chat') !== null
}

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
  // The selected token, else the player's own: skills stay usable when nothing is selected.
  const token = useEffectiveToken(controller.pubkey)
  const chat = useGame((s) => s.chat)
  const pending = useTargeting((s) => s.pending)
  const firedAt = useTargeting((s) => s.firedAt)
  const rules = controller.rules
  const isGm = controller.connection.isGm
  const mayUse = isGm || (token?.owner === controller.pubkey)
  const custom = useGame((s) => s.customSkills)
  const { skills, character, labelOf, shortfall, use } = useSkillCasting(controller, token)

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

  const list: CSSProperties = { display: 'grid', gap: 6 }
  const btn = (active: boolean, disabled: boolean): CSSProperties => ({
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 10, rowGap: 0, alignItems: 'center', textAlign: 'left',
    minHeight: 'var(--control)', padding: '6px 10px', borderRadius: 8, width: '100%',
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
          Aiming {pending.name}: pick on the table, then Cast. Tap the caster or press Esc to cancel.
        </p>
      )}
      {token && character && mayUse && (
        <div style={list}>
          {skills.map((skill) => {
            const reason = shortfall(skill)
            const disabled = reason !== null
            const active = pending?.skillId === skill.id && pending.source === token.id
            return (
              <button key={skill.id} type="button" style={btn(active, disabled)} disabled={disabled} onClick={() => use(skill)} aria-pressed={active} title={skill.description}>
                <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {skill.name}
                  {skill.id in custom && <span className="muted small" style={{ marginLeft: 6, fontWeight: 400 }} title="Custom skill for this game">custom</span>}
                </span>
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

/** The table's `targeting` prop for the pending skill; dispatches `skill.use` once the staged pick is confirmed. */
export function useSkillTargeting(controller: GameController | null): TargetingProps | undefined {
  const pending = useTargeting((s) => s.pending)
  const sourceExists = useGame((s) => (pending ? !!s.tokens[pending.source] : true))
  useEffect(() => { if (pending && !sourceExists) useTargeting.getState().clear() }, [pending, sourceExists])

  // Outcome toast: on a phone or tablet the sheet closes to aim, so the Skills panel's own outcome
  // box is gone by the time the result lands. When the Chat panel is not on screen either, the
  // first result lines of a cast made here go out as a toast. This hook outlives the panel.
  useEffect(() => {
    let toasted: number | null = null
    let lastChat = useGame.getState().chat
    return useGame.subscribe((s) => {
      if (s.chat === lastChat) return
      lastChat = s.chat
      const firedAt = useTargeting.getState().firedAt
      if (!firedAt || firedAt === toasted) return
      const lines = s.chat.filter((m) => m.kind === 'system' && m.at >= firedAt).map((m) => m.text)
      if (!lines.length) return
      toasted = firedAt
      if (chatVisible()) return
      pushToast({ text: outcomeToastText(lines), key: 'skill-outcome', ttl: 6000 })
    })
  }, [])
  return useMemo<TargetingProps | undefined>(() => {
    if (!pending || !controller) return undefined
    return {
      name: pending.name,
      shape: pending.shape,
      source: pending.source,
      isPlayerCharacter: (id) => {
        const s = useGame.getState()
        const t = s.tokens[id]
        return t ? isPlayerCharacter(t, t.character ? s.characters[t.character] : undefined, s.meta?.gm) : false
      },
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
