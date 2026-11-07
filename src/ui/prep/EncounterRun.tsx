/**
 * Encounters at the table (Play, GM drawer): the saved encounters with Run, which places the
 * creatures on the live scene (hidden or visible) and then asks "Roll initiative for N
 * creatures?". Building encounters in depth is the Library's (the Saved shelf); a quick one (one
 * creature × count) can still be saved here while improvising.
 */
import { useMemo, useState } from 'react'
import type { Encounter } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { pushToast } from '../toasts'
import { usePersisted } from '../shell/usePersisted'
import { CreaturePicker, useCompendium, type Compendium } from '../panels/CreaturesPrep'
import { encounterSize, newEncounter, newRow, sortEncounters } from './encounters'
import { initiativeOffer, rollForPlaced, runEncounter } from './runEncounter'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function EncounterRun({ controller }: { controller: GameController }) {
  const compendium = useCompendium(controller.rules)
  const stored = useGame((s) => s.encounters)
  const templates = useGame((s) => s.creatures)
  const tokens = useGame((s) => s.tokens)
  const noScene = useGame((s) => !s.meta?.activeScene)
  const list = useMemo(() => sortEncounters(stored), [stored])
  const [prefs, setPrefs] = usePersisted<{ visible: boolean }>('vtt.encounters.run', { visible: false })
  const [busy, setBusy] = useState<string | null>(null)
  const [offer, setOffer] = useState<{ encounter: string; tokens: TokenId[] } | null>(null)
  const [adding, setAdding] = useState(false)

  const run = async (e: Encounter) => {
    setBusy(e.id); setOffer(null)
    try {
      const r = await runEncounter(controller, e, { visible: prefs.visible, compendium: compendium.creatures, templates })
      if (r.missing.length) pushToast({ text: `Skipped ${r.missing.join(', ')}: stat block not found` })
      if (r.tokens.length) {
        useGame.getState().setSelectedToken(r.tokens[0]!)
        setOffer({ encounter: e.id, tokens: r.tokens })
      }
    } catch (err) {
      pushToast({ text: `Run failed: ${errText(err)}` })
    } finally { setBusy(null) }
  }
  const roll = async () => {
    if (!offer) return
    const o = offer
    setOffer(null)
    await rollForPlaced(controller, { id: o.encounter }, o.tokens)
  }

  return (
    <div className="panel encounter-run">
      {noScene && <p className="muted small">Make a scene live to run an encounter.</p>}
      <label className="check" style={{ marginTop: 0 }}>
        <input type="checkbox" checked={prefs.visible} onChange={(ev) => setPrefs({ visible: ev.target.checked })} />
        Place visible <span className="muted small">(off: hidden until you reveal them)</span>
      </label>
      {list.length === 0 && !adding && <p className="muted small">No saved encounters yet. Save creature groups on the Library’s Saved shelf, or a quick one here.</p>}
      <ul className="list">
        {list.map((e) => {
          const n = encounterSize(e)
          const onTable = e.placed.filter((id) => !!tokens[id]).length
          const asking = offer?.encounter === e.id
          return (
            <li key={e.id} style={{ display: 'block', padding: 'var(--sp-2)', cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minHeight: 'var(--control)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{e.name || 'Encounter'}</strong>
                  <span className="muted small"> · {n} {n === 1 ? 'creature' : 'creatures'}{onTable ? ` · ${onTable} on table` : ''}</span>
                </span>
                <button type="button" className="primary" disabled={noScene || n === 0 || busy !== null} onClick={() => void run(e)}
                  title={prefs.visible ? 'Place the creatures, visible, then offer initiative' : 'Place the creatures, hidden, then offer initiative'}>
                  {busy === e.id ? 'Placing…' : 'Run'}
                </button>
              </div>
              {asking && (
                <div className="row" role="alert" style={{ marginTop: 'var(--sp-1)', alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>{initiativeOffer(offer.tokens.length)}</span>
                  <button type="button" className="primary" onClick={() => void roll()}>Roll initiative</button>
                  <button type="button" onClick={() => setOffer(null)}>Not now</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {adding
        ? <QuickEncounter controller={controller} compendium={compendium} index={list.length} onDone={() => setAdding(false)} />
        : <button type="button" className="wide" onClick={() => setAdding(true)}>+ Quick encounter</button>}
    </div>
  )
}

/** One creature (or a plain mini) × count, saved as an encounter. */
function QuickEncounter({ controller, compendium, index, onDone }: { controller: GameController; compendium: Compendium; index: number; onDone(): void }) {
  const rules = controller.rules
  const hasCreatures = compendium.status !== 'none'
  const [creature, setCreature] = useState<{ ref: string; name: string } | null>(null)
  const [plain, setPlain] = useState('')
  const [count, setCount] = useState(3)
  const name = creature?.name ?? plain.trim()
  const save = () => {
    const n = Math.max(1, Math.min(30, Math.floor(count) || 1))
    const row = creature ? newRow(0, { creatureRef: creature.ref, count: n }) : newRow(0, { count: n, overrides: { name } })
    const e = { ...newEncounter(index), name: `${name} ×${n}`, rows: [row] }
    void controller.dispatch({ type: 'encounter.upsert', encounter: e })
    onDone()
  }
  return (
    <div className="props" style={{ display: 'grid', gap: 'var(--sp-1)' }}>
      {hasCreatures && rules && !creature && <CreaturePicker rules={rules} compendium={compendium} onPick={(ref, nm) => setCreature({ ref, name: nm })} autoFocus />}
      {creature && <p style={{ margin: 0 }}><strong>{creature.name}</strong> <button type="button" className="tiny" onClick={() => setCreature(null)}>Change</button></p>}
      {!hasCreatures && <label>Creature<input value={plain} onChange={(ev) => setPlain(ev.target.value)} placeholder="Goblin" autoFocus /></label>}
      <div className="row" style={{ marginTop: 0, alignItems: 'end' }}>
        <label style={{ width: 80, margin: 0 }}>Count<input type="number" min={1} max={30} value={count} onChange={(ev) => setCount(Number(ev.target.value))} /></label>
        <span className="spacer" />
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="button" className="primary" disabled={!name} onClick={save}>Save</button>
      </div>
    </div>
  )
}
