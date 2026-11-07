/**
 * Initiative tracker. The order lives in the shared document (`initiative`), so every client sees
 * the same list with the current combatant marked. The GM gets Start (rolls every sheet-bearing
 * token of the live scene), Next, End, and a per-row editor for the score, the position and
 * removal; players read the list and see their own token's row marked.
 *
 * `InitiativeChip` is the HUD summary ("Round 2 · Pip's turn"); it also watches the store and,
 * when the turn moves, toasts the new combatant and selects their token for its owner and the GM.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useSession } from '../session'
import type { InitiativeEntry, InitiativeState } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { newSeed, rollFromSeed } from '@/dice/fair'
import { ListRow } from '../components'
import { pushToast } from '../toasts'
import { requestOpenPanel } from '../shell/useShortcuts'
import { focusToken } from '@/table/tableState'
import { combatantName, combatants, concernsViewer, currentEntry, DEFAULT_INITIATIVE_FORMULA, moveEntry, possessive, rollInitiative, seedFor, turnLabel, withScore } from './initiative'
import './initiative.css'

export function InitiativePanel({ controller }: { controller: GameController }) {
  const init = useGame((s) => s.initiative)
  const tokens = useGame((s) => s.tokens)
  const characters = useGame((s) => s.characters)
  const scene = useGame((s) => s.meta?.activeScene ?? null)
  const selected = useGame((s) => s.selectedToken)
  const setSelectedToken = useGame((s) => s.setSelectedToken)
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<TokenId | null>(null)

  const active = !!init?.active
  const order = init?.order ?? []
  // Players never see hidden tokens listed; the GM sees every row.
  const rows = useMemo(() => (isGm ? order : order.filter((e) => !tokens[e.token]?.hidden)), [order, tokens, isGm])
  const current = currentEntry(init)
  const who = current ? `${possessive(combatantName(tokens[current.token], isGm))} turn` : null
  const eligible = useMemo(() => combatants(tokens, scene), [tokens, scene])
  const addable = useMemo(
    () => Object.values(tokens).filter((t) => t.scene === scene && !order.some((e) => e.token === t.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [tokens, scene, order],
  )

  const dispatchOrder = (next: InitiativeEntry[]) => void controller.dispatch({ type: 'initiative.set', order: next })

  const start = async () => {
    if (!eligible.length) {
      pushToast({ text: 'No tokens with a sheet in this scene', key: 'initiative' })
      return
    }
    setBusy(true)
    try {
      const seed = newSeed()
      const rolled = await rollInitiative(eligible, characters, controller.rules, seed)
      await controller.dispatch({ type: 'initiative.start', order: rolled, seed })
    } finally {
      setBusy(false)
    }
  }
  const next = () => void controller.dispatch({ type: 'initiative.next' })
  const end = () => {
    setEditing(null)
    void controller.dispatch({ type: 'initiative.end' })
  }
  const add = async (id: TokenId) => {
    const seed = newSeed()
    const roll = await rollFromSeed(DEFAULT_INITIATIVE_FORMULA, seedFor(seed, id))
    dispatchOrder(withScore([...order, { token: id, score: roll.total }], id, roll.total))
  }
  const remove = (id: TokenId) => {
    setEditing(null)
    void controller.dispatch({ type: 'initiative.remove', token: id })
  }
  const commitScore = (id: TokenId, raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const entry = order.find((e) => e.token === id)
    if (!entry || entry.score === n) return
    dispatchOrder(withScore(order, id, n))
  }

  return (
    <div className="panel initiative">
      <h3>Initiative</h3>
      <div className="init-head">
        <span className="init-status">
          {active ? <>Round <strong>{init?.round}</strong> · {who ?? 'nobody in the order'}</> : <span className="muted">Not in combat</span>}
        </span>
        {isGm && (
          <div className="init-actions">
            {active ? (
              <>
                <button type="button" className="primary" onClick={next} disabled={order.length === 0} aria-label="Next turn">Next ›</button>
                <button type="button" onClick={end}>End</button>
              </>
            ) : (
              <button type="button" className="primary" onClick={() => void start()} disabled={busy || !scene} title={!scene ? 'No active scene' : undefined}>
                {busy ? 'Rolling…' : 'Start'}
              </button>
            )}
          </div>
        )}
      </div>

      {active && rows.length > 0 && (
        <ul className="list init-list" aria-label="Turn order">
          {rows.map((e) => {
            const t = tokens[e.token]
            const isCurrent = current?.token === e.token
            const mine = !!t && t.owner === me && !isGm
            const open = isGm && editing === e.token
            const idx = order.findIndex((x) => x.token === e.token)
            const name = combatantName(t, isGm)
            const editor = open ? (
              <div className="init-edit" role="group" aria-label={`Edit ${name}`}>
                <label className="init-edit-score">
                  <span>Score</span>
                  <input
                    key={`${e.token}:${e.score}`}
                    type="number"
                    inputMode="numeric"
                    defaultValue={e.score}
                    aria-label={`Initiative score for ${name}`}
                    onBlur={(ev) => commitScore(e.token, ev.currentTarget.value)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.currentTarget as HTMLInputElement).blur() }}
                  />
                </label>
                <div className="init-edit-row">
                  <button type="button" onClick={() => dispatchOrder(moveEntry(order, idx, idx - 1))} disabled={idx <= 0} aria-label={`Move ${name} up`}>▲ Up</button>
                  <button type="button" onClick={() => dispatchOrder(moveEntry(order, idx, idx + 1))} disabled={idx >= order.length - 1} aria-label={`Move ${name} down`}>▼ Down</button>
                  <button type="button" className="danger" onClick={() => remove(e.token)} aria-label={`Remove ${name} from initiative`}>Remove</button>
                </div>
              </div>
            ) : null
            const onSelect = () => {
              if (t) setSelectedToken(t.id)
              if (isGm) setEditing(open ? null : e.token)
            }
            return (
              <ListRow
                key={e.token}
                className={`init-row${isCurrent ? ' current' : ''}${mine ? ' mine' : ''}`}
                selected={!isGm && selected === e.token}
                expanded={isGm ? open : undefined}
                onSelect={onSelect}
                label={`${name}, initiative ${e.score}${isCurrent ? ', current turn' : ''}${mine ? ', your token' : ''}`}
                trailing={editor}
              >
                <span className="init-turn" aria-hidden>{isCurrent ? '▶' : ''}</span>
                {t && <span className="dot" style={{ background: t.color }} />}
                <span className="init-name">
                  <strong>{name}</strong>
                  {mine && <span className="muted small">you</span>}
                  {isGm && t?.hidden && <span className="muted small">hidden</span>}
                </span>
                <span className="init-score">{e.score}</span>
              </ListRow>
            )
          })}
        </ul>
      )}

      {active && rows.length === 0 && <p className="muted init-empty">{isGm ? 'Nobody in the order. Add a token below or end the encounter.' : 'Waiting for the GM to set the order.'}</p>}
      {!active && (
        <p className="muted small init-empty">
          {isGm
            ? eligible.length
              ? `Start rolls initiative for ${eligible.length} ${eligible.length === 1 ? 'token' : 'tokens'} with a sheet in this scene.`
              : 'Give tokens a character sheet to roll initiative for them.'
            : 'The order appears here when the GM starts an encounter.'}
        </p>
      )}

      {isGm && active && addable.length > 0 && (
        <label className="init-add">
          <span className="muted small">Add</span>
          <select value="" aria-label="Add a token to the order" onChange={(ev) => { const id = ev.target.value as TokenId; if (id) void add(id) }}>
            <option value="">Token…</option>
            {addable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.hidden ? ' (hidden)' : ''}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

/** Round and token of the current turn; null between encounters. Equal keys mean the same turn. */
function turnKey(s: InitiativeState | null): string | null {
  const cur = currentEntry(s)
  return s && cur ? `${s.round}:${cur.token}` : null
}

/**
 * Reacts to the turn moving: toasts "Pip's turn" for everyone and selects the token for its owner
 * and the GM. The first snapshot is a baseline, so joining mid-fight announces nothing.
 */
export function useTurnNotices(controller: GameController | null): void {
  useEffect(() => {
    if (!controller) return
    const me = controller.pubkey
    const isGm = controller.connection.isGm
    let prev = turnKey(useGame.getState().initiative)
    return useGame.subscribe((s) => {
      const key = turnKey(s.initiative)
      if (key === prev) return
      prev = key
      const cur = currentEntry(s.initiative)
      if (!cur) return
      const token = s.tokens[cur.token]
      // The owner gets "Your turn" and the camera on their token; everyone else the name.
      const mine = !!token && !isGm && token.owner === me
      const text = mine ? `Your turn: ${token.name}` : `${possessive(combatantName(token, isGm))} turn`
      pushToast({ text, key: 'initiative-turn', ttl: mine ? 6000 : 4000 })
      s.pushNotice(text)
      if (token && concernsViewer(token, me, isGm)) s.setSelectedToken(token.id)
      if (mine) focusToken(token.id)
    })
  }, [controller])
}

/** HUD chip: "Round 2 · Pip's turn"; a tap opens the Initiative panel. Nothing between encounters. */
export function InitiativeChip() {
  const { controller } = useSession()
  const init = useGame((s) => s.initiative)
  const tokens = useGame((s) => s.tokens)
  useTurnNotices(controller)
  if (!controller) return null
  const label = turnLabel(init, tokens, controller.connection.isGm)
  if (!label) return null
  return (
    <div className="chip init-chip">
      <button type="button" className="chip-main" onClick={() => requestOpenPanel('initiative')} aria-label={`${label}. Open initiative`}>
        <span className="init-chip-glyph" aria-hidden>⚔</span>
        <span className="chip-name">{label}</span>
        <span className="chip-hint">›</span>
      </button>
    </div>
  )
}
