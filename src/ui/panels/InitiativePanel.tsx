/**
 * Initiative tracker. The order lives in the shared document (`initiative`), so every client sees
 * the same list with the current combatant marked. The GM gets Start (rolls every sheet-bearing
 * token of the live scene, copies of one creature as a group if wanted), Next, End (posts the
 * encounter summary), "Add all" for the rest of the scene, and a per-row editor for the score,
 * the position, grouping, a declared next action and removal; players read the list and see
 * their own token's row marked.
 *
 * Each row is an encounter frame (HP, bloodied/down, defense, conditions, declared action and its
 * targets); hovering or focusing a row highlights the token on the table. Scores stay out of the
 * way until a row is tapped.
 *
 * `InitiativeChip` is the HUD turn strip (round badge and token discs in turn order); it also watches the store and,
 * when the turn moves, toasts the new combatant and selects their token for its owner and the GM.
 * On the GM's client it also slots in initiative rolled from a sheet.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { currentSlot, slotRange } from '@/state/initiative'
import { useSession } from '../session'
import type { InitiativeEntry, InitiativeState } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { newSeed } from '@/dice/fair'
import { ListRow } from '../components'
import { pushToast } from '../toasts'
import { requestOpenPanel } from '../shell/useShortcuts'
import { usePersisted } from '../shell/usePersisted'
import { focusToken, useTableUi } from '@/table/tableState'
import { inkOn } from '@/table/tokenLabel'
import { discSlots, turnStrip } from '@/table/turnStrip'
import { SkillIcon } from '../skillbar/skillIcons'
import {
  combatantName, combatants, concernsViewer, encounterSummary, joinAbove, lateJoin, leaveGroup, moveEntry, possessive, recentSheetInitiative, rollInitiative,
  rollLateJoin, sheetInitiativeRoll, slotName, summaryHasNews, turnLabel, withScore, withSheetInitiative,
} from './initiative'
import { DeclareForm, FrameLine, frameData } from './EncounterFrame'
import './initiative.css'
import { Icon } from '@/ui/icons'

/** The tracker's own preferences (persisted by the panel; read here for starts from elsewhere). */
export const INITIATIVE_PREFS_KEY = 'vtt.initiative'

function readGroupPref(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(INITIATIVE_PREFS_KEY) ?? 'null') as { group?: unknown } | null
    return typeof v?.group === 'boolean' ? v.group : true
  } catch { return true }
}

/**
 * GM: roll initiative for every sheet-bearing token of the live scene and start combat. The same
 * start from the tracker, the top bar, the token hand and the command palette, so all of them
 * honour "copies of a creature share one roll" and initiative players already rolled from a sheet.
 * Resolves false when nobody can fight.
 */
export async function startCombat(controller: GameController, opts: { group?: boolean; include?: TokenId | readonly TokenId[] } = {}): Promise<boolean> {
  const s = useGame.getState()
  const scene = s.meta?.activeScene ?? null
  const eligible = combatants(s.tokens, scene)
  // Extra tokens join even when hidden (an encounter just placed, the token in hand).
  const include: readonly TokenId[] = typeof opts.include === 'string' ? [opts.include] : opts.include ?? []
  for (const id of include) {
    const extra = s.tokens[id]
    if (extra && !eligible.some((t) => t.id === extra.id)) eligible.push(extra)
  }
  if (!eligible.length) {
    pushToast({ text: 'No tokens with a sheet in this scene', key: 'initiative' })
    return false
  }
  const seed = newSeed()
  const known = recentSheetInitiative(s.chat, s.tokens, scene, Date.now())
  const rolled = await rollInitiative(eligible, s.characters, controller.rules, seed, { group: opts.group ?? readGroupPref(), known })
  await controller.dispatch({ type: 'initiative.start', order: rolled, seed })
  return true
}

/** GM: end combat, posting the encounter summary when something happened. */
export function endCombat(controller: GameController): void {
  const s = useGame.getState()
  const rules = controller.rules
  const primary = rules?.pack.resources[0]
  const isDown = (id: TokenId) => {
    const t = s.tokens[id]
    const c = t?.character ? s.characters[t.character] : undefined
    return frameData(t, c, rules).vital === 'dead'
  }
  const summary = encounterSummary(s.initiative, s.tokens, primary?.id, isDown)
  void controller.dispatch(summary && summaryHasNews(summary) ? { type: 'initiative.end', summary } : { type: 'initiative.end' })
}

/** Light the token up on the table while its row is pointed at (the range preview with no reach). */
function highlight(token: TokenId | null): void {
  const ui = useTableUi.getState()
  if (token) ui.set({ previewRange: { source: token, cells: 0 } })
  else if (ui.previewRange?.cells === 0) ui.set({ previewRange: null })
}

export function InitiativePanel({ controller }: { controller: GameController }) {
  const init = useGame((s) => s.initiative)
  const tokens = useGame((s) => s.tokens)
  const characters = useGame((s) => s.characters)
  const scene = useGame((s) => s.meta?.activeScene ?? null)
  const showHpToPlayers = useGame((s) => s.meta?.showHpToPlayers ?? false)
  const selected = useGame((s) => s.selectedToken)
  const setSelectedToken = useGame((s) => s.setSelectedToken)
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const rules = controller.rules
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<TokenId | null>(null)
  const [revealed, setRevealed] = useState<TokenId | null>(null)
  const [prefs, setPrefs] = usePersisted('vtt.initiative', { group: true })

  const active = !!init?.active
  const order = init?.order ?? []
  // Players never see hidden tokens listed; the GM sees every row.
  const rows = useMemo(() => (isGm ? order : order.filter((e) => !tokens[e.token]?.hidden)), [order, tokens, isGm])
  const slot = currentSlot(init)
  const who = slot.length ? `${possessive(slotName(slot, tokens, isGm))} turn` : null
  const eligible = useMemo(() => combatants(tokens, scene), [tokens, scene])
  const addable = useMemo(
    () => Object.values(tokens).filter((t) => t.scene === scene && !order.some((e) => e.token === t.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [tokens, scene, order],
  )
  const fillable = addable.filter((t) => !t.hidden)
  const showState = isGm || showHpToPlayers

  // Leaving the panel drops the table highlight.
  useEffect(() => () => highlight(null), [])

  const dispatchOrder = (next: InitiativeEntry[]) => void controller.dispatch({ type: 'initiative.set', order: next })

  const start = async () => {
    setBusy(true)
    try { await startCombat(controller, { group: prefs.group }) } finally { setBusy(false) }
  }
  const next = () => void controller.dispatch({ type: 'initiative.next' })
  const end = () => {
    setEditing(null)
    endCombat(controller)
  }
  /** Late join: the token rolls the way Start rolls it and lands in its slot (or its group's). */
  const addTokens = async (ids: TokenId[]) => {
    let next = order
    for (const id of ids) {
      const t = tokens[id]
      if (!t) continue
      const score = await rollLateJoin(t, characters, rules, newSeed())
      next = prefs.group ? lateJoin(next, t, score) : withScore([...next, { token: id, score }], id, score)
    }
    if (next !== order) dispatchOrder(next)
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
            const idx = order.findIndex((x) => x.token === e.token)
            const isCurrent = slot.some((x) => x.token === e.token)
            const mine = !!t && t.owner === me && !isGm
            const open = isGm && editing === e.token
            const showScore = open || revealed === e.token
            const name = combatantName(t, isGm)
            const [gStart, gEnd] = slotRange(order, idx)
            const grouped = gEnd > gStart
            const declared = init?.declared?.[e.token]
            const character = t?.character ? characters[t.character] : undefined
            const data = frameData(t, character, rules)
            const editor = open && t ? (
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
                  <button type="button" onClick={() => dispatchOrder(moveEntry(order, idx, idx - 1))} disabled={idx <= 0} aria-label={`Move ${name} up`}><Icon name="chevron-up" size={16} /> Up</button>
                  <button type="button" onClick={() => dispatchOrder(moveEntry(order, idx, idx + 1))} disabled={idx >= order.length - 1} aria-label={`Move ${name} down`}><Icon name="chevron-down" size={16} /> Down</button>
                  {grouped ? (
                    <button type="button" onClick={() => dispatchOrder(leaveGroup(order, e.token))} aria-label={`${name} acts alone`}>Ungroup</button>
                  ) : (
                    <button type="button" onClick={() => dispatchOrder(joinAbove(order, idx))} disabled={idx <= 0} aria-label={`${name} shares the turn above`}>Group <Icon name="chevron-up" size={16} /></button>
                  )}
                  <button type="button" className="danger" onClick={() => remove(e.token)} aria-label={`Remove ${name} from initiative`}>Remove</button>
                </div>
                <DeclareForm
                  token={t}
                  order={order}
                  tokens={tokens}
                  rules={rules}
                  declared={declared}
                  onDeclare={(action) => void controller.dispatch({ type: 'initiative.declare', action })}
                  onResolve={() => void controller.dispatch({ type: 'initiative.resolve', token: e.token })}
                />
              </div>
            ) : null
            const onSelect = () => {
              if (t) setSelectedToken(t.id)
              if (isGm) setEditing(open ? null : e.token)
              else setRevealed(revealed === e.token ? null : e.token)
            }
            const groupCls = grouped ? ` grouped${idx === gStart ? ' group-start' : ''}${idx === gEnd ? ' group-end' : ''}` : ''
            const vitalCls = showState && data.vital ? ` ${data.vital}` : ''
            return (
              <ListRow
                key={e.token}
                className={`init-row${isCurrent ? ' current' : ''}${mine ? ' mine' : ''}${groupCls}${vitalCls}`}
                selected={!isGm && selected === e.token}
                expanded={isGm ? open : undefined}
                onSelect={onSelect}
                label={`${name}${showScore ? `, initiative ${e.score}` : ''}${isCurrent ? ', current turn' : ''}${mine ? ', your token' : ''}${declared ? `, declared ${declared.label}` : ''}`}
                trailing={editor}
                rowProps={{
                  onPointerEnter: () => highlight(e.token),
                  onPointerLeave: () => highlight(null),
                  onFocus: () => highlight(e.token),
                  onBlur: () => highlight(null),
                }}
              >
                <span className="init-turn" aria-hidden>{isCurrent && idx === gStart ? <Icon name="play" size={12} /> : null}</span>
                {t && <span className="dot" style={{ background: t.color }} />}
                <span className="init-main">
                  <span className="init-name">
                    <strong>{name}</strong>
                    {mine && <span className="muted small">you</span>}
                    {isGm && t?.hidden && <span className="muted small">hidden</span>}
                  </span>
                  <FrameLine data={data} showState={showState} declared={declared} tokens={tokens} isGm={isGm} />
                </span>
                {showScore && <span className="init-score">{e.score}</span>}
              </ListRow>
            )
          })}
        </ul>
      )}

      {active && rows.length === 0 && <p className="muted init-empty">{isGm ? 'Nobody in the order. Add a token below or end the encounter.' : 'Waiting for the GM to set the order.'}</p>}
      {active && rows.length > 0 && <p className="muted small init-hint">{isGm ? 'Tap a row for its score, grouping and declared action.' : 'Tap a row to see its initiative.'}</p>}
      {!active && (
        <p className="muted small init-empty">
          {isGm
            ? eligible.length
              ? `Start rolls initiative for ${eligible.length} ${eligible.length === 1 ? 'token' : 'tokens'} with a sheet in this scene.`
              : 'Give tokens a character sheet to roll initiative for them.'
            : 'The order appears here when the GM starts an encounter. Initiative you roll from your sheet counts.'}
        </p>
      )}
      {isGm && !active && (
        <label className="init-option">
          <input type="checkbox" checked={prefs.group} onChange={(ev) => setPrefs({ ...prefs, group: ev.target.checked })} />
          <span>Copies of a creature share one roll</span>
        </label>
      )}

      {isGm && active && addable.length > 0 && (
        <div className="init-add">
          <span className="muted small">Add</span>
          <select value="" aria-label="Add a token to the order" onChange={(ev) => { const id = ev.target.value as TokenId; if (id) void addTokens([id]) }}>
            <option value="">Token…</option>
            {addable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.hidden ? ' (hidden)' : ''}</option>)}
          </select>
          {fillable.length > 1 && (
            <button type="button" onClick={() => void addTokens(fillable.map((t) => t.id))} title="Every visible token of this scene not yet in the order">
              All {fillable.length}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Round and slot of the current turn; null between encounters. Equal keys mean the same turn. */
function turnKey(s: InitiativeState | null): string | null {
  const slot = currentSlot(s)
  return s && slot.length ? `${s.round}:${slot[0]!.token}` : null
}

/**
 * Reacts to the turn moving: toasts "Pip's turn" for everyone and selects the token for its owner
 * and the GM. The first snapshot is a baseline, so joining mid-fight announces nothing. In a group
 * slot each player hears about the member they own.
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
      const slot = currentSlot(s.initiative)
      if (!slot.length) return
      const members = slot.map((e) => s.tokens[e.token])
      const owned = isGm ? undefined : members.find((t) => !!t && t.owner === me)
      const token = owned ?? members[0]
      // The owner gets "Your turn" and the camera on their token; everyone else the name.
      const mine = !!owned
      const text = mine ? `Your turn: ${owned.name}` : `${possessive(slotName(slot, s.tokens, isGm))} turn`
      pushToast({ text, key: 'initiative-turn', ttl: mine ? 6000 : 4000 })
      s.pushNotice(text)
      if (token && concernsViewer(token, me, isGm)) s.setSelectedToken(token.id)
      if (mine) focusToken(owned.id)
    })
  }, [controller])
}

/**
 * GM only: an initiative roll made from a sheet during an encounter sets that combatant's score,
 * or brings its token into the fight (late join). Rolls already in the log when this mounts are
 * history and ignored.
 */
export function useSheetInitiative(controller: GameController | null): void {
  useEffect(() => {
    if (!controller?.connection.isGm) return
    let seen = useGame.getState().chat.length
    return useGame.subscribe((s) => {
      if (s.chat.length <= seen) { seen = s.chat.length; return }
      const fresh = s.chat.slice(seen)
      seen = s.chat.length
      for (const m of fresh) {
        const r = sheetInitiativeRoll(m)
        if (!r) continue
        const st = useGame.getState()
        const out = withSheetInitiative(st.initiative, st.tokens, st.meta?.activeScene ?? null, r.character, r.total)
        if (!out) continue
        void controller.dispatch({ type: 'initiative.set', order: out.order })
        const who = st.tokens[out.joined ?? out.updated[0]!]?.name ?? 'Someone'
        pushToast({ text: out.joined ? `${who} joins initiative (${r.total})` : `${who} rolled ${r.total} for initiative`, key: 'initiative-add', ttl: 3000 })
      }
    })
  }, [controller])
}

/**
 * HUD turn strip: the round, then a disc per slot (token colour and initials, the way the
 * table draws them) starting at the current one, which is larger and ringed; upcoming ones follow
 * and what does not fit becomes "+N". A group shows a member count; a declared action shows its
 * icon on the disc. Players never see hidden tokens. A tap opens the Initiative panel. Nothing
 * between encounters. The wrapper spans the row so the strip knows how many discs fit.
 */
export function InitiativeChip() {
  const { controller } = useSession()
  const init = useGame((s) => s.initiative)
  const tokens = useGame((s) => s.tokens)
  useTurnNotices(controller)
  useSheetInitiative(controller)
  const [width, setWidth] = useState<number | null>(null)
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!wrap) return
    setWidth(wrap.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(wrap.clientWidth))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [wrap])
  if (!controller) return null
  const isGm = controller.connection.isGm
  const label = turnLabel(init, tokens, isGm)
  // Before the first measurement assume the narrowest phone row (320 px wide, rail on the right).
  const strip = label ? turnStrip(init, tokens, isGm, controller.pubkey, discSlots(width ?? 236)) : null
  if (!label || !strip) return null
  return (
    <div className="init-strip-wrap" ref={setWrap}>
      <button type="button" className="chip init-chip" onClick={() => requestOpenPanel('initiative')} aria-label={`${label}. Open initiative`}>
        <span className="init-round" aria-hidden>
          <small>R</small>{strip.round}
        </span>
        {strip.discs.map((d) => (
          <span
            key={d.token}
            className={`init-disc${d.current ? ' current' : ''}${d.mine ? ' mine' : ''}${d.hidden ? ' hidden' : ''}`}
            style={{ background: d.color, color: inkOn(d.color) }}
            title={d.intent ? `${d.name}: ${d.intent.label}` : d.name}
            aria-hidden
          >
            {d.initials}
            {d.count && <span className="init-disc-count">{d.count}</span>}
            {d.intent && (
              <span className="init-disc-intent">
                {d.intent.icon ? <SkillIcon icon={d.intent.icon} kind="single" className="init-intent-icon" /> : '!'}
              </span>
            )}
          </span>
        ))}
        {strip.overflow > 0 && <span className="init-disc more" aria-hidden>+{strip.overflow}</span>}
      </button>
    </div>
  )
}
