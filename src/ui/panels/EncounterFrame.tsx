/**
 * The GM's encounter frame inside an initiative row (FFXIV party-list style): a compact HP bar
 * with the bloodied/down glyph, the defense badge when the pack has one, condition chips, and
 * what the combatant has declared it will do next ("Bite → Pip"). Plus the GM's declare form.
 * Players get the same frame for what they may see (HP only when the GM shares it).
 */
import { useMemo, useState } from 'react'
import type { Character, DeclaredAction, InitiativeEntry, Token } from '@/core/doc'
import type { SkillId, TokenId } from '@/core/ids'
import type { RulesEngine } from '@/rules'
import { conditionChips, defenseAbbr, defenseAttribute, HP_BAND_COLORS, hpBand, readDefense, readResource, VITAL_LABELS, vitalState, type ConditionChip, type ResourceReading, type VitalState } from '@/table/tokenHud'
import { tokenSkillList } from '../skillbar/tokenSkills'
import { combatantName } from './initiative'
import { Icon } from '@/ui/icons'
import { StatusBadge } from '../StatusBadge'

export interface FrameData {
  hp: ResourceReading | null
  hpName: string
  vital: VitalState | null
  defense: { value: number; abbr: string } | null
  chips: ConditionChip[]
}

/** Everything the frame shows for one token, read off its sheet through the pack. */
export function frameData(token: Token | undefined, character: Character | undefined, rules: RulesEngine | null): FrameData {
  const pack = rules?.pack
  const primary = pack?.resources[0]
  const evaluate = character && rules ? (e: string) => rules.evaluateNow(e, character) : undefined
  const hp = character && primary ? readResource(character.data, primary, evaluate) : null
  const attr = defenseAttribute(pack?.attributes)
  const value = character && attr ? readDefense(character.data, attr, evaluate) : null
  return {
    hp,
    hpName: primary?.name ?? 'HP',
    vital: vitalState(hp),
    defense: attr && value !== null ? { value, abbr: defenseAbbr(attr) } : null,
    chips: token ? conditionChips(token, character, pack?.conditions ?? []) : [],
  }
}

/** Glyph for a vital state; the visual pass may restyle these, the class names stay. */
export function VitalGlyph({ state }: { state: VitalState }) {
  return (
    <span className={`vital vital--${state}`} title={VITAL_LABELS[state]} role="img" aria-label={VITAL_LABELS[state]}>
      <Icon name={state === 'dead' ? 'skull' : 'bloodied'} size={14} />
    </span>
  )
}

/** Who a declared action is aimed at, as the viewer may name them. */
export function targetNames(action: DeclaredAction, tokens: Record<TokenId, Token>, isGm: boolean): string[] {
  return action.targets.map((id) => tokens[id]).filter((t): t is Token => !!t && (isGm || !t.hidden)).map((t) => combatantName(t, isGm))
}

const MAX_CHIPS = 4

export function FrameLine({ data, showState, declared, tokens, isGm }: {
  data: FrameData
  showState: boolean
  declared?: DeclaredAction
  tokens: Record<TokenId, Token>
  isGm: boolean
}) {
  const { hp, vital, defense, chips } = data
  const targets = declared ? targetNames(declared, tokens, isGm) : []
  const extra = chips.length - MAX_CHIPS
  if (!showState && !declared) return null
  return (
    <span className="init-frame">
      {showState && hp && (
        <span className="init-hp" title={`${data.hpName} ${hp.current}/${hp.max}`} aria-label={`${data.hpName} ${hp.current} of ${hp.max}`}>
          <span className="init-hp-fill" style={{ width: `${Math.min(100, Math.max(0, (hp.current / hp.max) * 100))}%`, background: HP_BAND_COLORS[hpBand(hp.current, hp.max)] }} />
        </span>
      )}
      {showState && vital && <VitalGlyph state={vital} />}
      {showState && defense && <span className="init-def" title={`${defense.abbr} ${defense.value}`}>{defense.abbr} {defense.value}</span>}
      {showState && chips.slice(0, MAX_CHIPS).map((c) => (
        <StatusBadge key={c.id} chip={c} size={16} label={c.remaining !== null ? `${c.name}, ${c.remaining} ${c.remaining === 1 ? 'turn' : 'turns'} left` : c.name} />
      ))}
      {showState && extra > 0 && <span className="init-cond more" title={chips.slice(MAX_CHIPS).map((c) => c.name).join(', ')}>+{extra}</span>}
      {declared && (
        <span className="init-intent" title={`Declared: ${declared.label}${targets.length ? ` → ${targets.join(', ')}` : ''}`}>
          <Icon name="flag" size={12} /> {declared.label}{targets.length > 0 && <span className="init-target"> → {targets.join(', ')}</span>}
        </span>
      )}
    </span>
  )
}

/**
 * GM form under a row: pick a skill of the token (or type an action), toggle its targets among
 * the other combatants, declare. A declared action shows Resolve instead of being edited in place.
 */
export function DeclareForm({ token, order, tokens, rules, declared, onDeclare, onResolve }: {
  token: Token
  order: readonly InitiativeEntry[]
  tokens: Record<TokenId, Token>
  rules: RulesEngine | null
  declared?: DeclaredAction
  onDeclare(action: Omit<DeclaredAction, 'at'>): void
  onResolve(): void
}) {
  const skills = useMemo(() => tokenSkillList(token, rules?.allSkills() ?? []), [token, rules])
  const [skill, setSkill] = useState<string>('')
  const [label, setLabel] = useState('')
  const [targets, setTargets] = useState<TokenId[]>([])
  if (declared) {
    return (
      <div className="init-declare" role="group" aria-label={`${token.name}'s declared action`}>
        <span className="init-declare-now"><Icon name="flag" size={12} /> {declared.label}</span>
        <button type="button" onClick={onResolve}>Resolve</button>
      </div>
    )
  }
  const others = order.map((e) => tokens[e.token]).filter((t): t is Token => !!t && t.id !== token.id)
  const chosen = skills.find((s) => s.id === skill)
  const text = label.trim() || chosen?.name || ''
  const toggle = (id: TokenId) => setTargets((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]))
  const declare = () => {
    if (!text) return
    const action: Omit<DeclaredAction, 'at'> = { token: token.id, label: text, targets }
    if (chosen) {
      action.skill = chosen.id as SkillId
      if (chosen.icon) action.icon = chosen.icon
    }
    onDeclare(action)
    setSkill('')
    setLabel('')
    setTargets([])
  }
  return (
    <div className="init-declare" role="group" aria-label={`Declare ${token.name}'s next action`}>
      <div className="init-declare-row">
        {skills.length > 0 && (
          <select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Skill">
            <option value="">Action…</option>
            {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={chosen?.name ?? 'Charges the door'} aria-label="Declared action" />
      </div>
      {others.length > 0 && (
        <div className="init-declare-targets" role="group" aria-label="Targets">
          {others.map((t) => (
            <button key={t.id} type="button" className={`init-target-chip${targets.includes(t.id) ? ' on' : ''}`} aria-pressed={targets.includes(t.id)} onClick={() => toggle(t.id)}>
              <span className="dot" style={{ background: t.color }} />{t.name}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="primary" onClick={declare} disabled={!text}>Declare</button>
    </div>
  )
}
