/**
 * GM prep: generate NPCs near the camera (hidden until revealed), browse the pack's creature
 * compendium and the game's own stat blocks, build and place encounters (saved in the game),
 * roll on the pack's random tables into chat, and add props to the scene.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { TokenId } from '@/core/ids'
import { randomName, randomNames } from '../prep/names'
import { spawnNpcs, setHidden, removeTokens, statBlock } from '../prep/npc'
import { ENCOUNTER_COLORS, newEncounter, newRow } from '../prep/encounters'
import { placeRows } from '../prep/placeCreatures'
import { formatTableRoll, rollTable, tableTitle } from '../prep/tables'
import { pushToast } from '../toasts'
import { AddProp } from './ObjectPanel'
import { Icon } from '@/ui/icons'
import { CreatureBrowser, CreaturePicker, creatureSummary, StatBlockEditor, useCompendium, type Compendium } from './CreaturesPrep'
import { Encounters } from './EncountersPrep'

export function PrepPanel({ controller }: { controller: GameController }) {
  const meta = useGame((s) => s.meta)
  const noScene = !meta?.activeScene
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const compendium = useCompendium(controller.rules)
  const hasCreatures = compendium.status !== 'none'
  const [openEncounter, setOpenEncounter] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  /** "Add" in the browser: into the open encounter, else a new one. */
  const addToEncounter = (ref: string, name: string) => {
    const s = useGame.getState()
    let e = openEncounter ? s.encounters[openEncounter] : undefined
    if (!e) {
      e = newEncounter(Object.keys(s.encounters).length)
      setOpenEncounter(e.id)
    }
    const next = { ...e, rows: [...e.rows, newRow(e.rows.length, { creatureRef: ref })] }
    void controller.dispatch({ type: 'encounter.upsert', encounter: next })
    pushToast({ text: `Added ${name} to ${next.name}`, ttl: 2500 })
  }

  return (
    <div className="panel">
      <h3>Prep</h3>
      {noScene && <p className="muted small">Activate a scene to place NPCs and encounters.</p>}
      {editing && <StatBlockEditor controller={controller} templateId={editing} compendium={compendium} onClose={() => setEditing(null)} />}
      <Section title="NPC generator" open><NpcGenerator controller={controller} disabled={noScene} compendium={compendium} /></Section>
      {hasCreatures && <Section title="Creatures"><CreatureBrowser controller={controller} compendium={compendium} onEdit={setEditing} onAdd={addToEncounter} /></Section>}
      <Section title="Encounters" open={!!openEncounter}>
        <Encounters controller={controller} disabled={noScene} compendium={compendium} open={openEncounter} setOpen={setOpenEncounter} onEditTemplate={setEditing} />
      </Section>
      <Section title="Random tables"><RandomTables controller={controller} /></Section>
      {meta?.activeScene && <Section title="Props"><AddProp controller={controller} sceneId={meta.activeScene} scene={scene} /></Section>}
    </div>
  )
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-1)', marginTop: 'var(--sp-2)' }}>
      <summary className="disclosure" style={{ fontWeight: 600 }}>{title}</summary>
      {children}
    </details>
  )
}

// ------------------------------------------------------------------------------- NPC generator

/**
 * Packs with a compendium place NPCs from a stat block ("Use stat block"); packs that roll NPCs
 * like characters (Mausritter) keep "Roll a character sheet" with the pack's chargen.
 */
function NpcGenerator({ controller, disabled, compendium }: { controller: GameController; disabled: boolean; compendium: Compendium }) {
  const rules = controller.rules
  const packId = rules?.pack.manifest.id
  const hasChargen = !!rules?.pack.chargen
  const hasCreatures = compendium.status !== 'none'
  const tokens = useGame((s) => s.tokens)
  const characters = useGame((s) => s.characters)
  const encounters = useGame((s) => s.encounters)
  const [name, setName] = useState('')
  const [count, setCount] = useState(1)
  const [sheet, setSheet] = useState(hasChargen)
  const [useStatBlock, setUseStatBlock] = useState(hasCreatures)
  const [creature, setCreature] = useState<{ ref: string; name: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<TokenId[]>([])
  const statMode = hasCreatures && useStatBlock

  const generate = async () => {
    setBusy(true); setError(null)
    try {
      const n = Math.max(1, Math.min(20, Math.floor(count) || 1))
      if (statMode) {
        if (!creature) { setPicking(true); return }
        const row = newRow(Object.keys(tokens).length, { creatureRef: creature.ref, count: n, ...(name.trim() ? { overrides: { name: name.trim() } } : {}) })
        const { placed } = await placeRows(controller, [row], compendium.creatures, useGame.getState().creatures)
        setLast(placed.flatMap((p) => p.tokens))
        return
      }
      const names = name.trim() ? (n === 1 ? [name.trim()] : Array.from({ length: n }, (_, i) => `${name.trim()} ${i + 1}`)) : randomNames(packId, n)
      const specs = names.map((nm, i) => ({ name: nm, color: ENCOUNTER_COLORS[(Object.keys(tokens).length + i) % ENCOUNTER_COLORS.length]!, generateSheet: sheet && hasChargen }))
      setLast((await spawnNpcs(controller, specs, { hidden: true })).map((s) => s.token.id))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const alive = last.filter((id) => tokens[id])
  const anyHidden = alive.some((id) => tokens[id]!.hidden)
  const saveAsEncounter = () => {
    if (!creature) return
    const e = newEncounter(Object.keys(encounters).length)
    const enc = { ...e, name: `${creature.name} ×${count}`, rows: [newRow(0, { creatureRef: creature.ref, count, ...(name.trim() ? { overrides: { name: name.trim() } } : {}) })] }
    void controller.dispatch({ type: 'encounter.upsert', encounter: enc })
    pushToast({ text: `Saved encounter ${enc.name}`, ttl: 2500 })
  }

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      {hasCreatures && (
        <div className="row" role="radiogroup" aria-label="NPC kind" style={{ marginTop: 0 }}>
          <label className="check" style={{ margin: 0 }}><input type="radio" name="npc-kind" checked={statMode} onChange={() => setUseStatBlock(true)} /> Use stat block</label>
          <label className="check" style={{ margin: 0 }}><input type="radio" name="npc-kind" checked={!statMode} onChange={() => setUseStatBlock(false)} /> {hasChargen ? 'Character sheet / plain mini' : 'Plain mini'}</label>
        </div>
      )}
      {statMode && rules && (
        <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <span style={{ flex: 1, minWidth: 0 }}>{creature ? <strong>{creature.name}</strong> : <span className="muted small">No creature picked</span>}</span>
            <button className="tiny" onClick={() => setPicking(!picking)}>{picking ? 'Close' : creature ? 'Change' : 'Pick creature'}</button>
          </div>
          {picking && <CreaturePicker rules={rules} compendium={compendium} onPick={(ref, nm) => { setCreature({ ref, name: nm }); setPicking(false) }} autoFocus />}
        </div>
      )}
      <div className="grid2">
        <label>Name
          <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={statMode ? creature?.name ?? 'from stat block' : 'random'} />
            <button className="icon" aria-label="Random name" title="Random name" onClick={() => setName(randomName(packId))}><Icon name="dice" /></button>
          </div>
        </label>
        <label>Count<input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
      </div>
      {!statMode && <label className="check"><input type="checkbox" checked={sheet && hasChargen} disabled={!hasChargen} onChange={(e) => setSheet(e.target.checked)} /> Roll a character sheet{!hasChargen && <span className="muted small"> (pack has no chargen)</span>}</label>}
      <button className="primary wide" disabled={busy || disabled || (statMode && compendium.status !== 'ready' && !creature?.ref.startsWith('game:'))} onClick={() => void generate()}>
        {busy ? 'Generating…' : statMode && !creature ? 'Pick a creature' : `Generate ${count > 1 ? `${count} NPCs` : 'NPC'} (hidden)`}
      </button>
      {statMode && creature && <button className="wide" onClick={saveAsEncounter}>Save as encounter</button>}
      {error && <p className="error small">{error}</p>}
      {alive.length > 0 && (
        <div>
          <div className="row" style={{ marginTop: 0 }}>
            <button onClick={() => void setHidden(controller, alive, !anyHidden)}>{anyHidden ? 'Reveal' : 'Hide'} {alive.length > 1 ? 'all' : ''}</button>
            <button className="danger" onClick={() => { void removeTokens(controller, alive); setLast([]) }}>Remove</button>
          </div>
          {alive.map((id) => {
            const t = tokens[id]!
            const c = t.character ? characters[t.character] : undefined
            const isCreature = !!c?.sheet && c.sheet === rules?.pack.manifest.creatures?.sheet
            return (
              <div key={id} style={{ marginTop: 'var(--sp-2)', padding: 'var(--sp-2)', background: 'var(--panel-2)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <span className="dot" style={{ background: t.color }} />
                  <strong style={{ flex: 1 }}>{t.name}</strong>
                  <span className="muted small">{t.hidden ? 'hidden' : 'visible'}</span>
                  <button className="tiny" onClick={() => useGame.getState().setSelectedToken(id)}>Select</button>
                </div>
                {c && isCreature && rules ? (
                  <p className="small" style={{ margin: 'var(--sp-1) 0 0' }}>{creatureSummary(rules, c.data)}</p>
                ) : c ? (
                  <dl style={{ margin: 'var(--sp-1) 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
                    {statBlock(rules, c).map((l) => <StatRow key={l.label} label={l.label} value={l.value} />)}
                  </dl>
                ) : <p className="muted small" style={{ margin: 'var(--sp-1) 0 0' }}>Plain mini, no sheet.</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return <><dt className="muted" style={{ margin: 0 }}>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd></>
}

// ------------------------------------------------------------------------------- Random tables

function RandomTables({ controller }: { controller: GameController }) {
  const rules = controller.rules
  const tables = useMemo(() => Object.keys(rules?.pack.chargen?.tables ?? {}), [rules])
  const [table, setTable] = useState(tables[0] ?? '')
  const [toChat, setToChat] = useState(true)
  const [last, setLast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!rules || tables.length === 0) return <p className="muted small">This pack has no random tables.</p>

  const roll = async () => {
    const id = table || tables[0]!
    setBusy(true)
    try {
      const text = formatTableRoll(await rollTable(rules, id, newSeed()))
      setLast(text)
      if (toChat) await controller.dispatch({ type: 'chat.say', text })
    } catch (e) { setLast(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      <label>Table
        <select value={table || tables[0]} onChange={(e) => setTable(e.target.value)}>
          {tables.map((t) => <option key={t} value={t}>{tableTitle(t)} ({rules.pack.chargen!.tables[t]!.die})</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={toChat} onChange={(e) => setToChat(e.target.checked)} /> Post the result to chat</label>
      <button className="primary wide" disabled={busy} onClick={() => void roll()}>{busy ? 'Rolling…' : 'Roll'}</button>
      {last && <p className="small" style={{ margin: 0, padding: 'var(--sp-2)', background: 'var(--panel-2)', borderRadius: 'var(--r-sm)', overflowWrap: 'anywhere' }}>{last}</p>}
    </div>
  )
}
