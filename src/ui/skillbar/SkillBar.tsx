/**
 * Token bar over the bottom of the table: everything a player does with their character in one
 * place, and what the GM does with any token.
 *
 * Which token: the selected one; a player who selected nothing (or someone else's token) sees
 * their own. The bar shows its name, an HP meter (the GM adjusts it with −/+, and the change floats
 * over the token for everyone), "Your turn" and End turn while it is up in combat, the sheet's
 * saves and the token's skills as icon chips with cost badges (hovering, focusing or holding a
 * skill chip rings its reach on the table), and ⋯ for the
 * token menu. The GM also gets the token's skill list editor, conditions, Hide/Show, initiative,
 * Assign and Remove. The bar hides while a skill is being aimed (the targeting bar takes over).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react'
import type { GameController } from '../controller'
import type { Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import { firstOwnedToken, useGame } from '@/state/store'
import { newSeed, rollFromSeed } from '@/dice/fair'
import { useTableUi } from '@/table/tableState'
import { readResource } from '@/table/tokenHud'
import { useTargeting } from '../targeting'
import { requestOpenPanel } from '../shell/useShortcuts'
import { requestSkillEditor } from '../skilleditor/requests'
import { pushToast } from '../toasts'
import { currentEntry, DEFAULT_INITIATIVE_FORMULA, combatants, rollInitiative, seedFor, withScore } from '../panels/initiative'
import { costLabel, useSkillCasting } from './useSkillCasting'
import { missingSkills, withoutSkill, withSkill } from './tokenSkills'
import { adjustResource, saveChipLabel, sheetSaves } from './tokenBar'
import { conditionStyle, rangePreviewFor, type RangePreview } from './barVisuals'
import { CostBadges, HpMeter } from './BarParts'
import { SkillIcon } from './skillIcons'
import { Icon } from '@/ui/icons'

type Card = 'skills' | 'conditions' | 'assign' | null

export function SkillBar({ controller }: { controller: GameController }) {
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const token = useGame((s) => {
    const sel = s.selectedToken ? s.tokens[s.selectedToken] : undefined
    if (isGm) return sel
    return sel && sel.owner === me ? sel : firstOwnedToken(s, me as PlayerPubkey)
  })
  const aimingAny = useTargeting((s) => s.pending !== null)
  const [card, setCard] = useState<{ token: TokenId; kind: Card } | null>(null)
  const casting = useSkillCasting(controller, token)
  const init = useGame((s) => s.initiative)
  const rules = controller.rules
  const saves = useMemo(() => sheetSaves(rules?.pack.sheet), [rules])
  const menuBtn = useRef<HTMLButtonElement>(null)

  // The range preview belongs to the chips: drop it when they go away (aiming, other token, unmount).
  const tokenId = token?.id
  useEffect(() => { setPreview(null); return () => setPreview(null) }, [tokenId, aimingAny])

  if (!token || aimingAny) return null
  const { skills, canUse, labelOf, shortfall, use, character } = casting
  const open = card?.token === token.id ? card.kind : null
  const toggle = (kind: Card) => setCard(open === kind ? null : { token: token.id, kind })

  const primary = rules?.pack.resources[0]
  const hp = character && rules && primary ? readResource(character.data, primary, (e) => rules.evaluateNow(e, character)) : null
  const active = !!init?.active
  const up = active && currentEntry(init)?.token === token.id
  const mayEnd = up && (isGm || token.owner === me)
  const inOrder = !!init?.order.some((e) => e.token === token.id)

  const roll = (label: string, formula: string) => {
    if (!character) return
    void controller.dispatch({ type: 'roll', formula, seed: newSeed(), label: `${character.name}: ${label}`, character: character.id })
  }
  const changeHp = (delta: number) => {
    if (!character || !primary) return
    const data = adjustResource(character.data, primary.id, delta, hp?.max)
    if (!data) return
    void controller.dispatch({ type: 'character.upsert', character: { ...character, data } })
    // Everyone sees the change float over the token, like a skill's damage or healing.
    const after = readResource(data, primary, (e) => rules!.evaluateNow(e, character))
    const moved = after && hp ? after.current - hp.current : 0
    if (moved) controller.floatNumbers?.(token.scene, [{ token: token.id, delta: moved, resource: primary.id }])
  }
  const endTurn = () => void controller.dispatch(isGm ? { type: 'initiative.next' } : { type: 'initiative.next', token: token.id })
  const openMenu = () => {
    const r = menuBtn.current?.getBoundingClientRect()
    useTableUi.getState().set({ contextMenu: { token: token.id, x: r ? r.left : 0, y: r ? r.top - 8 : 0 } })
  }

  return (
    <div className="skill-dock">
      {isGm && open === 'skills' && <TokenSkillsEditor controller={controller} token={token} onClose={() => setCard(null)} />}
      {isGm && open === 'conditions' && <ConditionsCard controller={controller} token={token} onClose={() => setCard(null)} />}
      {isGm && open === 'assign' && <AssignCard controller={controller} token={token} onClose={() => setCard(null)} />}
      <div className={`dock-bar token-bar${up ? ' up' : ''}`} role="toolbar" aria-label={`${token.name}`}>
        <div className="token-bar-head">
          <span className="dot" style={{ background: token.color }} />
          <strong className="token-bar-name">{token.name}</strong>
          {up && <span className="token-bar-turn">{isGm || token.owner !== me ? 'Up now' : 'Your turn'}</span>}
          {hp && (
            <span className="token-bar-hp" title={`${primary?.name ?? 'HP'} ${hp.current}/${hp.max}`}>
              {isGm && <button type="button" className="icon" aria-label={`${primary?.name} minus 1`} onClick={() => changeHp(-1)}>−</button>}
              <HpMeter current={hp.current} max={hp.max} label={primary?.name ?? 'HP'} />
              {isGm && <button type="button" className="icon" aria-label={`${primary?.name} plus 1`} onClick={() => changeHp(1)}>+</button>}
            </span>
          )}
          {mayEnd && <button type="button" className="tiny primary end-turn" onClick={endTurn}>End turn</button>}
          <button ref={menuBtn} type="button" className="icon token-bar-more" aria-label={`${token.name} actions`} title="More actions" onClick={openMenu}><Icon name="more" /></button>
        </div>
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
              <button key={skill.id} type="button" className="skill-chip" disabled={reason !== null}
                title={reason ? `${skill.name}: ${reason}` : skill.description} onClick={() => use(skill)}
                aria-label={`${skill.name}, ${reason ?? costLabel(skill, labelOf)}`}
                {...previewHandlers(skill, token.id)}>
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
            <button type="button" className="tiny gm-secondary" onClick={() => void controller.dispatch({ type: 'token.update', token: token.id, patch: { hidden: !token.hidden } })}>
              {token.hidden ? 'Show' : 'Hide'}
            </button>
            <InitiativeButton controller={controller} token={token} active={active} inOrder={inOrder} />
            <button type="button" className={`tiny gm-secondary${open === 'assign' ? ' on' : ''}`} aria-expanded={open === 'assign'} onClick={() => toggle('assign')}>Assign</button>
            <button type="button" className="tiny danger gm-secondary" onClick={() => { void controller.dispatch({ type: 'token.remove', token: token.id }); useGame.getState().clearSelection() }}>Remove</button>
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
      if (!active) {
        const eligible = combatants(s.tokens, s.meta?.activeScene ?? null)
        if (!eligible.some((t) => t.id === token.id)) eligible.push(token)
        const seed = newSeed()
        const order = await rollInitiative(eligible, s.characters, controller.rules, seed)
        await controller.dispatch({ type: 'initiative.start', order, seed })
        return
      }
      if (inOrder) { await controller.dispatch({ type: 'initiative.remove', token: token.id }); return }
      const order = s.initiative?.order ?? []
      const r = await rollFromSeed(DEFAULT_INITIATIVE_FORMULA, seedFor(newSeed(), token.id))
      await controller.dispatch({ type: 'initiative.set', order: withScore([...order, { token: token.id, score: r.total }], token.id, r.total) })
      pushToast({ text: `${token.name} joins initiative (${r.total})`, key: 'initiative-add', ttl: 3000 })
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
  const set = (ids: string[]) => void controller.dispatch({ type: 'token.update', token: token.id, patch: { conditions: ids } })
  return (
    <div className="dock-card" role="dialog" aria-label={`${token.name}'s conditions`}>
      <div className="token-skills-head"><strong>{token.name}'s conditions</strong><button type="button" className="icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      {defs.length === 0 && <p className="muted small">This ruleset has no conditions.</p>}
      <div className="condition-chips">
        {defs.map((c) => {
          const on = token.conditions.includes(c.id)
          const { color, label } = conditionStyle(defs, c.id)
          return (
            <button key={c.id} type="button" className={`tiny condition-chip${on ? ' on' : ''}`} aria-pressed={on} title={c.description}
              style={{ '--cond': color } as CSSProperties}
              onClick={() => set(on ? token.conditions.filter((x) => x !== c.id) : [...token.conditions, c.id])}>
              <span className="condition-chip-badge" aria-hidden="true">{label}</span>
              <span className="condition-chip-name">{c.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** GM: hand the token to someone at the table, or take it back. */
function AssignCard({ controller, token, onClose }: { controller: GameController; token: Token; onClose(): void }) {
  const presence = useGame((s) => s.presence)
  const players = Object.values(presence).filter((p) => p.pubkey !== controller.pubkey)
  const assign = (owner: PlayerPubkey) => { void controller.dispatch({ type: 'token.claim', token: token.id, owner }); onClose() }
  return (
    <div className="dock-card" role="dialog" aria-label={`Assign ${token.name}`}>
      <div className="token-skills-head"><strong>Who plays {token.name}?</strong><button type="button" className="icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      <div className="condition-chips">
        <button type="button" className={`tiny${!token.owner || token.owner === controller.pubkey ? ' on' : ''}`} onClick={() => assign(controller.pubkey as PlayerPubkey)}>GM (you)</button>
        {players.map((p) => (
          <button key={p.pubkey} type="button" className={`tiny${token.owner === p.pubkey ? ' on' : ''}`} onClick={() => assign(p.pubkey)}>{p.name}</button>
        ))}
      </div>
      {players.length === 0 && <p className="muted small">Nobody else is connected right now.</p>}
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
