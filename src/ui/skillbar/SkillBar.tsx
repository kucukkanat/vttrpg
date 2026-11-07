/**
 * Skill bar: the selected token's skills as buttons over the bottom of the table, so casting is one
 * tap away instead of inside a panel. Tapping a skill aims it on the table (self skills fire at once);
 * tapping it again cancels the aim. The GM also gets "Skills ✎" to choose which skills this token
 * has, add existing or new ones, and remove them (TokenSkillsEditor).
 */
import { useState } from 'react'
import type { GameController } from '../controller'
import type { Token } from '@/core/doc'
import { useGame } from '@/state/store'
import { useTargeting } from '../targeting'
import { requestOpenPanel } from '../shell/useShortcuts'
import { requestSkillEditor } from '../skilleditor/requests'
import { costLabel, useSkillCasting } from './useSkillCasting'
import { missingSkills, withoutSkill, withSkill } from './tokenSkills'

export function SkillBar({ controller }: { controller: GameController }) {
  const token = useGame((s) => (s.selectedToken ? s.tokens[s.selectedToken] : undefined))
  const isGm = controller.connection.isGm
  const aimingAny = useTargeting((s) => s.pending !== null)
  const [editing, setEditing] = useState<string | null>(null)
  const casting = useSkillCasting(controller, token)
  if (!token || aimingAny) return null
  const mine = isGm || token.owner === controller.pubkey
  if (!mine) return null
  const { skills, canUse, labelOf, shortfall, use, character } = casting
  const editorOpen = isGm && editing === token.id

  return (
    <div className="skill-dock">
      {editorOpen && <TokenSkillsEditor controller={controller} token={token} onClose={() => setEditing(null)} />}
      <div className="dock-bar skill-bar" role="toolbar" aria-label={`${token.name}'s skills`}>
        {!character && <span className="muted small skill-bar-note">{isGm ? `${token.name} has no sheet; skills need one to be used.` : 'No character sheet.'}</span>}
        {character && skills.length === 0 && <span className="muted small skill-bar-note">{token.name} has no skills.</span>}
        {character && skills.map((skill) => {
          const reason = canUse ? shortfall(skill) : 'not yours'
          return (
            <button key={skill.id} type="button" className="skill-chip" disabled={reason !== null}
              title={reason ? `${skill.name}: ${reason}` : skill.description} onClick={() => use(skill)}>
              <span className="skill-chip-name">{skill.name}</span>
              <span className="skill-chip-cost">{reason ?? costLabel(skill, labelOf)}</span>
            </button>
          )
        })}
        {isGm && (
          <button type="button" className={`skill-chip skill-chip--edit${editorOpen ? ' on' : ''}`} aria-expanded={editorOpen}
            title={`Choose ${token.name}'s skills`} onClick={() => setEditing(editorOpen ? null : token.id)}>
            <span className="skill-chip-name">Skills ✎</span>
            <span className="skill-chip-cost">edit</span>
          </button>
        )}
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
        <button type="button" className="icon" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      {skills.length === 0 && <p className="muted small">No skills yet.</p>}
      <ul className="token-skills-list">
        {skills.map((s) => (
          <li key={s.id}>
            <span className="token-skills-name">{s.name}{s.id in custom ? <span className="muted small"> · custom</span> : null}</span>
            <span className="muted small">{costLabel(s, labelOf)}</span>
            <button type="button" className="tiny" onClick={() => { requestSkillEditor({ kind: 'edit', skillId: s.id }); openEditor() }}>Edit</button>
            <button type="button" className="icon" aria-label={`Remove ${s.name} from ${token.name}`} title="Remove from this token"
              onClick={() => setSkills(withoutSkill(token, all, s.id))}>✕</button>
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
