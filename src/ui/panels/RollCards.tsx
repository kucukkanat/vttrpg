/**
 * Chat cards for the combat flow: the roll-mode bar (advantage, who sees the result), the extras
 * under a roll (mode tags, Reveal for the GM, the apply-damage card), skill outcome cards and
 * concentration save prompts. ChatPanel renders them; the data lives on the chat message.
 */
import { useState } from 'react'
import type { ChatMessage, DamageFactor, DamageTarget, RollVisibility, Token } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { newSeed } from '@/dice'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { useRollMode, VISIBILITY_LABELS } from '../rollMode'
import './RollCards.css'

/** Advantage / disadvantage for the next d20 roll and who sees results. `compact` drops the select's label. */
export function RollModeBar({ compact = false }: { compact?: boolean }) {
  const { advantage, visibility, setAdvantage, setVisibility } = useRollMode()
  const isGmHint = visibility === 'blind' ? 'You will not see the result' : undefined
  return (
    <div className="roll-mode" role="group" aria-label="Roll mode">
      <button type="button" className={`tiny${advantage === 'advantage' ? ' on' : ''}`} aria-pressed={advantage === 'advantage'}
        title="Next d20 roll: roll two, keep the better" onClick={() => setAdvantage(advantage === 'advantage' ? null : 'advantage')}>Adv</button>
      <button type="button" className={`tiny${advantage === 'disadvantage' ? ' on' : ''}`} aria-pressed={advantage === 'disadvantage'}
        title="Next d20 roll: roll two, keep the worse" onClick={() => setAdvantage(advantage === 'disadvantage' ? null : 'disadvantage')}>Dis</button>
      <label className="roll-mode-vis" title={isGmHint}>
        {!compact && <span className="muted small">Show</span>}
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as RollVisibility)} aria-label="Who sees roll results">
          {(Object.keys(VISIBILITY_LABELS) as RollVisibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>)}
        </select>
      </label>
    </div>
  )
}

/** Tags and actions under a roll the viewer can read. */
export function RollExtras({ m, controller }: { m: ChatMessage; controller: GameController }) {
  const isGm = controller.connection.isGm
  const r = m.roll
  if (!r) return null
  // A roll without a pass/fail verdict is an amount: offer it to the apply-damage card.
  const amount = !(r.outcome && 'success' in r.outcome) && r.total > 0
  return (
    <>
      {(r.advantage || m.visibility) && (
        <span className="roll-extras">
          {r.advantage && <span className="roll-tag mode">{r.advantage}</span>}
          {m.visibility && <span className="roll-tag mode">{m.visibility === 'gm' ? 'GM only' : 'blind'}</span>}
          {isGm && m.visibility && <button type="button" className="tiny" onClick={() => void controller.dispatch({ type: 'roll.reveal', message: m.id })}>Reveal</button>}
        </span>
      )}
      {(amount || m.damage) && !m.visibility && <DamageCardView m={m} controller={controller} />}
    </>
  )
}

const FACTORS: { factor: DamageFactor; label: string; title: string }[] = [
  { factor: 1, label: 'Apply', title: 'Apply as damage' },
  { factor: 0.5, label: '½', title: 'Half damage' },
  { factor: 2, label: '×2', title: 'Double damage' },
  { factor: -1, label: 'Heal', title: 'Heal by this amount' },
]

function appliedText(a: NonNullable<DamageTarget['applied']>, type?: string): string {
  if (a.factor === -1) return `+${a.amount}`
  const scale = a.factor === 0.5 ? ' ½' : a.factor === 2 ? ' ×2' : ''
  return `−${a.amount}${type ? ` ${type}` : ''}${scale}${a.note ? ` (${a.note})` : ''}`
}

/**
 * The apply-damage card: one row per target with Apply / ½ / ×2 / Heal, or what was applied and
 * Undo. Targets are those already on the card plus the viewer's selected tokens. The GM may act
 * on every row, a player on their own tokens; others see the results.
 */
export function DamageCardView({ m, controller }: { m: ChatMessage; controller: GameController }) {
  const tokens = useGame((s) => s.tokens)
  const selected = useGame((s) => s.selectedTokens)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('')
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const types = controller.rules?.pack.manifest.damage?.types ?? []
  const card = m.damage
  const listed = card?.targets ?? []
  const mayAct = (t: Token | undefined) => !!t && (isGm || t.owner === me)
  const extra = selected.filter((id) => !listed.some((x) => x.token === id) && mayAct(tokens[id]))
  // A plain roll's card stays folded behind one button until someone wants to apply it.
  if (!card && !open) {
    if (!isGm && !Object.values(tokens).some((t) => t.owner === me)) return null
    return <button type="button" className="tiny damage-open" onClick={() => setOpen(true)} title="Apply this amount to the selected tokens">Apply…</button>
  }
  const rows: DamageTarget[] = [...listed, ...extra.map((token) => ({ token }))]
  const send = (token: TokenId, factor: DamageFactor | 0) =>
    void controller.dispatch({ type: 'damage.apply', message: m.id, token, factor, ...(!card ? { damageType: type } : {}) })
  const shownType = card?.type ?? (type || undefined)
  const typeName = (id?: string) => (id ? (types.find((t) => t.id === id)?.name ?? id).toLowerCase() : undefined)
  return (
    <div className="damage-card" role="group" aria-label={card?.heal ? 'Apply healing' : 'Apply damage'}>
      {!card && types.length > 0 && (
        <select className="damage-type" value={type} onChange={(e) => setType(e.target.value)} aria-label="Damage type">
          <option value="">untyped</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {rows.length === 0 && <span className="muted small">Select tokens on the table to apply this to them.</span>}
      {rows.map((row) => {
        const t = tokens[row.token]
        const can = mayAct(t)
        const amount = row.amount ?? card?.amount ?? m.roll?.total ?? 0
        return (
          <div key={row.token} className="damage-row">
            <span className="damage-who">{t?.name ?? 'Gone'}</span>
            {row.amount !== undefined && row.amount !== card?.amount && <span className="muted small">{row.amount}</span>}
            {row.applied && <span className={`damage-done${row.applied.factor === -1 ? ' heal' : ''}`}>{appliedText(row.applied, typeName(shownType))}</span>}
            {can && (
              <span className="damage-actions">
                {(card?.heal ? FACTORS.filter((f) => f.factor === -1) : FACTORS)
                  .filter((f) => row.applied?.factor !== f.factor)
                  .map((f) => (
                    <button key={f.factor} type="button" className="tiny" title={`${f.title} (${amount})`} onClick={() => send(row.token, f.factor)}>{f.label}</button>
                  ))}
                {row.applied && <button type="button" className="tiny" onClick={() => send(row.token, 0)}>Undo</button>}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A concentration save prompt: Roll save for the GM and the token's owner, Ignore for the GM. */
export function ConcentrationPrompt({ m, controller }: { m: ChatMessage; controller: GameController }) {
  const token = useGame((s) => (m.concentration ? s.tokens[m.concentration.token] : undefined))
  const c = m.concentration
  if (!c) return null
  const isGm = controller.connection.isGm
  const can = isGm || token?.owner === controller.pubkey
  if (c.result) return <span className={`roll-tag ${c.result === 'lost' ? 'bad' : 'ok'}`}>{c.result === 'kept' ? 'concentration kept' : c.result === 'lost' ? 'concentration lost' : 'dismissed'}</span>
  if (!can || !token?.concentrating) return null
  return (
    <span className="damage-actions">
      <button type="button" className="tiny primary" onClick={() => void controller.dispatch({ type: 'concentration.save', message: m.id, token: c.token, seed: newSeed() })}>Roll save</button>
      <button type="button" className="tiny" onClick={() => void controller.dispatch({ type: 'concentration.end', token: c.token })}>Drop it</button>
      {isGm && <button type="button" className="tiny" onClick={() => void controller.dispatch({ type: 'concentration.dismiss', message: m.id })}>Ignore</button>}
    </span>
  )
}
