/**
 * Token bar over the bottom of the table: everything a player does with their character in one
 * place, and what the GM does with any token.
 *
 * Which token: the selected one; a player who selected nothing (or someone else's token) sees
 * their own. The bar shows its name, an HP meter (the GM adjusts it with −/+, and the change floats
 * over the token for everyone), "Your turn" and End turn while it is up in combat, the sheet's
 * saves and the token's skills as icon chips with cost badges (hovering, focusing or holding a
 * skill chip rings its reach on the table), and ⋯ for the
 * token menu. The GM also gets the token's skill list editor, conditions and initiative here; Hide,
 * Assign and Remove are in the token menu (⋯, right-click or long-press), one home each. The bar hides while a skill is being aimed (the targeting bar takes over).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react'
import type { GameController } from '../controller'
import type { Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import { firstOwnedToken, useGame } from '@/state/store'
import { newSeed } from '@/dice/fair'
import { inCurrentSlot } from '@/state/initiative'
import { useTableUi } from '@/table/tableState'
import { conditionChips, defenseAbbr, defenseAttribute, readDefense, readResource } from '@/table/tokenHud'
import { mergeHandlers, pinOnClick, tipTriggerProps } from '../tips/useTipTrigger'
import { useMoveDraft } from '@/table/twoTapMove'
import { useTargeting } from '../targeting'
import { requestOpenPanel } from '../shell/useShortcuts'
import { requestSkillEditor } from '../skilleditor/requests'
import { pushToast } from '../toasts'
import { lateJoin, rollLateJoin } from '../panels/initiative'
import { startCombat } from '../panels/InitiativePanel'
import { costLabel, useSkillCasting } from './useSkillCasting'
import { missingSkills, withoutSkill, withSkill } from './tokenSkills'
import { saveChipLabel, sheetSaves } from './tokenBar'
import { changeTokenHp } from './changeHp'
import { conditionStyle, rangePreviewFor, type RangePreview } from './barVisuals'
import { CostBadges, HpMeter } from './BarParts'
import { SkillIcon } from './skillIcons'
import { StatusBadge } from '../StatusBadge'
import { Icon } from '@/ui/icons'

type Card = 'skills' | 'conditions' | null

export function SkillBar({ controller }: { controller: GameController }) {
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const token = useGame((s) => {
    const sel = s.selectedToken ? s.tokens[s.selectedToken] : undefined
    if (isGm) return sel
    return sel && sel.owner === me ? sel : firstOwnedToken(s, me as PlayerPubkey)
  })
  const aimingAny = useTargeting((s) => s.pending !== null)
  const moving = useMoveDraft((s) => s.draft !== null)
  const showHp = useGame((s) => s.meta?.showHpToPlayers ?? false)
  const [card, setCard] = useState<{ token: TokenId; kind: Card } | null>(null)
  const casting = useSkillCasting(controller, token)
  const init = useGame((s) => s.initiative)
  const rules = controller.rules
  const saves = useMemo(() => sheetSaves(rules?.pack.sheet), [rules])
  const menuBtn = useRef<HTMLButtonElement>(null)

  // The range preview belongs to the chips: drop it when they go away (aiming, other token, unmount).
  const tokenId = token?.id
  useEffect(() => { setPreview(null); return () => setPreview(null) }, [tokenId, aimingAny])

  // Aiming a skill or previewing a two-tap move: the table's own bar takes the bottom.
  if (!token || aimingAny || moving) return null
  const { skills, canUse, labelOf, shortfall, use, character } = casting
  const open = card?.token === token.id ? card.kind : null
  const toggle = (kind: Card) => setCard(open === kind ? null : { token: token.id, kind })

  const primary = rules?.pack.resources[0]
  const hp = character && rules && primary ? readResource(character.data, primary, (e) => rules.evaluateNow(e, character)) : null
  const active = !!init?.active
  const up = active && inCurrentSlot(init, token.id)
  // The pack's defense value (D&D 5e's AC), shown beside HP when the pack has one.
  const defAttr = defenseAttribute(rules?.pack.attributes)
  const defense = character && rules && defAttr ? readDefense(character.data, defAttr, (e) => rules.evaluateNow(e, character)) : null
  const mayEnd = up && (isGm || token.owner === me)
  const inOrder = !!init?.order.some((e) => e.token === token.id)
  // Statuses with their tap-to-pin explanations: the GM always, players on their own token or when HP is shown.
  const statuses = isGm || token.owner === me || showHp ? conditionChips(token, character, rules?.pack.conditions ?? []) : []

  const roll = (label: string, formula: string) => {
    if (!character) return
    void controller.dispatch({ type: 'roll', formula, seed: newSeed(), label: `${character.name}: ${label}`, character: character.id })
  }
  // Everyone sees the change float over the token, like a skill's damage or healing.
  const changeHp = (delta: number) => { changeTokenHp(controller, token, delta) }
  const endTurn = () => void controller.dispatch(isGm ? { type: 'initiative.next' } : { type: 'initiative.next', token: token.id })
  const openMenu = () => {
    const r = menuBtn.current?.getBoundingClientRect()
    useTableUi.getState().set({ contextMenu: { token: token.id, x: r ? r.left : 0, y: r ? r.top - 8 : 0 } })
  }

  return (
    <div className="skill-dock">
      {isGm && open === 'skills' && <TokenSkillsEditor controller={controller} token={token} onClose={() => setCard(null)} />}
      {isGm && open === 'conditions' && <ConditionsCard controller={controller} token={token} onClose={() => setCard(null)} />}
      <div className={`dock-bar token-bar${up ? ' up' : ''}`} role="toolbar" aria-label={`${token.name}`}>
        <div className="token-bar-head">
          <button type="button" className="token-bar-card" onClick={() => requestOpenPanel('character')} aria-label={`${token.name}: open the character card`} title="Character card">
            <span className="dot" style={{ background: token.color }} />
            <strong className="token-bar-name">{token.name}</strong>
          </button>
          <button type="button" className="icon token-bar-find" onClick={() => useTableUi.getState().focusToken(token.id)} aria-label={`Centre the camera on ${token.name}`} title="Find on the table"><Icon name="crosshair" size={18} /></button>
          {up && <span className="token-bar-turn">{isGm || token.owner !== me ? 'Up now' : 'Your turn'}</span>}
          {hp && (
            <span className="token-bar-hp" title={`${primary?.name ?? 'HP'} ${hp.current}/${hp.max}`}>
              {isGm && <button type="button" className="icon" aria-label={`${primary?.name} minus 1`} onClick={() => changeHp(-1)}>−</button>}
              <HpMeter current={hp.current} max={hp.max} label={primary?.name ?? 'HP'} />
              {isGm && <button type="button" className="icon" aria-label={`${primary?.name} plus 1`} onClick={() => changeHp(1)}>+</button>}
            </span>
          )}
          {defAttr && defense !== null && <span className="token-bar-def" title={`${defAttr.name} ${defense}`}>{defenseAbbr(defAttr)} {defense}</span>}
          {mayEnd && <button type="button" className="tiny primary end-turn" onClick={endTurn}>End turn</button>}
          <button ref={menuBtn} type="button" className="icon token-bar-more" aria-label={`${token.name} actions`} title="More actions" onClick={openMenu}><Icon name="more" /></button>
        </div>
        {statuses.length > 0 && (
          <div className="token-bar-status" role="group" aria-label={`${token.name}'s statuses`}>
            {statuses.map((c) => (
              <button key={c.id} type="button" className="status-badge" style={{ '--cond': c.color } as CSSProperties}
                aria-label={`${c.name}, status: what it does`} {...pinOnClick(() => ({ kind: 'condition', condition: c.id }))}>
                <span className="condition-chip-badge" aria-hidden="true">{c.label}</span>
                <span className="status-badge-name">{c.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="token-bar-chips">
          {!character && <span className="muted small skill-bar-note">{isGm ? 'No sheet: skills and saves need one.' : 'No character sheet.'}</span>}
          {character && canUse && saves.map((s) => (
            <button key={s.label} type="button" className="skill-chip save-chip" title={`Roll ${s.label} (${s.formula})`} onClick={() => roll(s.label, s.formula)}>
              <SkillIcon icon="d20" kind="self" />
              <span className="skill-chip-text">
                <span className="skill-chip-name">{saveChipLabel(s.label)}</span>
                <span className="skill-chip-cost">save</span>
              </span>
            </button>
          ))}
          {character && skills.map((skill) => {
            const reason = canUse ? shortfall(skill) : 'not yours'
            return (
              <button key={skill.id} type="button" className="skill-chip" aria-disabled={reason !== null || undefined}
                onClick={() => { if (reason === null) use(skill) }}
                aria-label={`${skill.name}, ${reason ?? costLabel(skill, labelOf)}`} aria-keyshortcuts="i"
                {...mergeHandlers(previewHandlers(skill, token.id), tipTriggerProps(() => ({ kind: 'skill', skill: skill.id, token: token.id, reason })))}>
                <SkillIcon icon={skill.icon} kind={skill.target.kind} />
                <span className="skill-chip-text">
                  <span className="skill-chip-name">{skill.name}</span>
                  <span className={`skill-chip-cost${reason ? ' skill-chip-reason' : ''}`}>{reason ?? <CostBadges skill={skill} labelOf={labelOf} />}</span>
                </span>
              </button>
            )
          })}
          {character && skills.length === 0 && <span className="muted small skill-bar-note">No skills.</span>}
          {isGm && (
            <button type="button" className={`skill-chip skill-chip--edit${open === 'skills' ? ' on' : ''}`} aria-expanded={open === 'skills'}
              title={`Choose ${token.name}'s skills`} onClick={() => toggle('skills')}>
              <span className="skill-chip-name">Skills <Icon name="pencil" size={14} /></span>
              <span className="skill-chip-cost">edit</span>
            </button>
          )}
        </div>
        {isGm && (
          <div className="token-bar-gm">
            <button type="button" className={`tiny${open === 'conditions' ? ' on' : ''}`} aria-expanded={open === 'conditions'} onClick={() => toggle('conditions')}>
              Conditions{token.conditions.length ? ` (${token.conditions.length})` : ''}
            </button>
            <InitiativeButton controller={controller} token={token} active={active} inOrder={inOrder} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Show (or with null, clear) the reach ring on the table; skips writes that change nothing. */
function setPreview(p: RangePreview | null) {
  const ui = useTableUi.getState()
  const cur = ui.previewRange
  if (p === null ? cur === null : cur !== null && cur.source === p.source && cur.cells === p.cells) return
  ui.set({ previewRange: p })
}

function focusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible') } catch { return true }
}

/**
 * Chip handlers for the range preview: a mouse or pen hovering, keyboard focus, or a finger held
 * on the chip (until it lifts or slides off) show the skill's reach around the token.
 */
function previewHandlers(skill: SkillDef, source: TokenId) {
  const show = () => setPreview(rangePreviewFor(skill, source))
  const hide = () => setPreview(null)
  return {
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType !== 'touch') show() },
    onPointerLeave: hide,
    onPointerDown: (e: PointerEvent) => { if (e.pointerType === 'touch') show() },
    onPointerUp: (e: PointerEvent) => { if (e.pointerType === 'touch') hide() },
    onPointerCancel: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => { if (focusVisible(e.currentTarget)) show() },
    onBlur: hide,
  }
}

/** GM: start combat (everyone with a sheet in the scene), add this token to it, or take it out. */
function InitiativeButton({ controller, token, active, inOrder }: { controller: GameController; token: Token; active: boolean; inOrder: boolean }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const s = useGame.getState()
      if (!active) { await startCombat(controller, { include: token.id }); return }
      if (inOrder) { await controller.dispatch({ type: 'initiative.remove', token: token.id }); return }
      // Late join: rolled like Start rolls it, and slotted in by score (or into its group).
      const order = s.initiative?.order ?? []
      const score = await rollLateJoin(token, s.characters, controller.rules, newSeed())
      await controller.dispatch({ type: 'initiative.set', order: lateJoin(order, token, score) })
      pushToast({ text: `${token.name} joins initiative (${score})`, key: 'initiative-add', ttl: 3000 })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className="tiny" disabled={busy} onClick={() => void run()}>
      {!active ? 'Start combat' : inOrder ? 'Leave combat' : 'Join combat'}
    </button>
  )
}

/** GM: toggle the pack's conditions on the token. */
function ConditionsCard({ controller, token, onClose }: { controller: GameController; token: Token; onClose(): void }) {
  const defs = controller.rules?.pack.conditions ?? []
  // Optional duration for the next condition switched on: whole turns of this token, ticking at the end (or start) of its turn.
  const [turns, setTurns] = useState('')
  const [tick, setTick] = useState<'end' | 'start'>('end')
  const toggle = (id: string, on: boolean) => {
    const conditions = on ? token.conditions.filter((x) => x !== id) : [...token.conditions, id]
    const effects = { ...(token.effects ?? {}) }
    const n = Math.floor(Number(turns))
    if (on) delete effects[id]
    else if (n >= 1) effects[id] = { remaining: n, ...(tick === 'start' ? { tick } : {}) }
    void controller.dispatch({ type: 'token.update', token: token.id, patch: { conditions, effects } })
  }
  return (
    <div className="dock-card" role="dialog" aria-label={`${token.name}'s conditions`}>
      <div className="token-skills-head"><strong>{token.name}'s conditions</strong><button type="button" className="icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      {defs.length === 0 && <p className="muted small">This ruleset has no conditions.</p>}
      {defs.length > 0 && (
        <div className="condition-duration">
          <label className="small">Lasts <input type="number" min={1} inputMode="numeric" value={turns} onChange={(e) => setTurns(e.target.value)} placeholder="∞" aria-label="Turns the next condition lasts" style={{ width: '4em' }} /> turns</label>
          <select value={tick} onChange={(e) => setTick(e.target.value as 'end' | 'start')} aria-label="Count down at">
            <option value="end">ends at end of turn</option>
            <option value="start">ends at start of turn</option>
          </select>
        </div>
      )}
      <div className="condition-chips">
        {defs.map((c) => {
          const on = token.conditions.includes(c.id)
          const left = on ? token.effects?.[c.id]?.remaining ?? null : null
          const look = conditionStyle(defs, c.id, left)
          return (
            <button key={c.id} type="button" className={`tiny condition-chip${on ? ' on' : ''}`} aria-pressed={on}
              title={left !== null ? `${c.description} (${left} ${left === 1 ? 'turn' : 'turns'} left)` : c.description}
              style={{ '--cond': look.color } as CSSProperties}
              onClick={() => toggle(c.id, on)}>
              <StatusBadge chip={look} off={!on} />
              <span className="condition-chip-name">{c.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** GM: the skills on one token, with remove, add from every known skill, create new, and edit. */
function TokenSkillsEditor({ controller, token, onClose }: { controller: GameController; token: Token; onClose(): void }) {
  const custom = useGame((s) => s.customSkills)
  const all = controller.rules?.allSkills() ?? []
  const { skills, labelOf } = useSkillCasting(controller, token)
  const missing = missingSkills(token, all)
  const setSkills = (ids: string[]) => void controller.dispatch({ type: 'token.update', token: token.id, patch: { skills: ids } })
  const openEditor = () => requestOpenPanel('skills-editor')

  return (
    <div className="dock-card token-skills" role="dialog" aria-label={`${token.name}'s skills`}>
      <div className="token-skills-head">
        <strong>{token.name}'s skills</strong>
        <button type="button" className="icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </div>
      {skills.length === 0 && <p className="muted small">No skills yet.</p>}
      <ul className="token-skills-list">
        {skills.map((s) => (
          <li key={s.id}>
            <span className="token-skills-name">{s.name}{s.id in custom ? <span className="muted small"> · custom</span> : null}</span>
            <span className="muted small">{costLabel(s, labelOf)}</span>
            <button type="button" className="tiny" onClick={() => { requestSkillEditor({ kind: 'edit', skillId: s.id }); openEditor() }}>Edit</button>
            <button type="button" className="icon" aria-label={`Remove ${s.name} from ${token.name}`} title="Remove from this token"
              onClick={() => setSkills(withoutSkill(token, all, s.id))}><Icon name="close" /></button>
          </li>
        ))}
      </ul>
      <div className="token-skills-add">
        <select value="" aria-label="Add a skill" disabled={missing.length === 0}
          onChange={(e) => { if (e.target.value) setSkills(withSkill(token, all, e.target.value)) }}>
          <option value="">{missing.length ? '+ Add a skill…' : 'Has every skill'}</option>
          {missing.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button" className="tiny" onClick={() => { requestSkillEditor({ kind: 'new', attachTo: token.id }); openEditor() }}>+ New skill</button>
      </div>
    </div>
  )
}
