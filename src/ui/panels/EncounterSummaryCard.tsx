/**
 * The end-of-encounter report in the chat log: rounds fought, then per combatant the damage dealt
 * and taken, healing done and knockouts, with a "down" mark for those who ended at zero. Hidden
 * combatants are left out for players.
 */
import type { EncounterSummary } from '@/core/doc'
import { Icon } from '@/ui/icons'

export function EncounterSummaryCard({ summary, isGm }: { summary: EncounterSummary; isGm: boolean }) {
  const rows = summary.rows.filter((r) => isGm || !r.hidden)
  const rounds = `${summary.rounds} ${summary.rounds === 1 ? 'round' : 'rounds'}`
  return (
    <div className="encounter-summary" role="group" aria-label={`Encounter summary, ${rounds}`}>
      <div className="encounter-summary-head">Encounter over · {rounds}</div>
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col" title="Damage dealt">Dealt</th>
              <th scope="col" title="Damage taken">Taken</th>
              <th scope="col" title="Healing done">Healed</th>
              <th scope="col" title="Knockouts">KOs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.token} className={r.down ? 'down' : undefined}>
                <th scope="row">{r.name}{r.down && <span className="encounter-down vital vital--dead" title="Ended the encounter down"> <Icon name="skull" size={14} label="down" /></span>}</th>
                <td>{r.dealt || '–'}</td>
                <td>{r.taken || '–'}</td>
                <td>{r.healed || '–'}</td>
                <td>{r.kos || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
