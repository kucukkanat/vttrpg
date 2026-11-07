/**
 * GM prep: generate NPCs near the camera (hidden until revealed), build and place encounters, and
 * roll on the pack's random tables into chat. Encounters persist in localStorage per game.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { TokenId } from '@/core/ids'
import { randomName, randomNames } from '../prep/names'
import { spawnNpcs, setHidden, removeTokens, statBlock, type Spawned } from '../prep/npc'
import { ENCOUNTER_COLORS, encounterSize, loadEncounters, newEncounter, newRow, saveEncounters, type Encounter, type EncounterRow } from '../prep/encounters'
import { formatTableRoll, rollTable, tableTitle } from '../prep/tables'

export function PrepPanel({ controller }: { controller: GameController }) {
  const meta = useGame((s) => s.meta)
  const noScene = !meta?.activeScene
  return (
    <div className="panel">
      <h3>Prep</h3>
      {noScene && <p className="muted small">Activate a scene to place NPCs and encounters.</p>}
      <Section title="NPC generator" open><NpcGenerator controller={controller} disabled={noScene} /></Section>
      <Section title="Encounters"><Encounters controller={controller} disabled={noScene} /></Section>
      <Section title="Random tables"><RandomTables controller={controller} /></Section>
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

function NpcGenerator({ controller, disabled }: { controller: GameController; disabled: boolean }) {
  const packId = controller.rules?.pack.manifest.id
  const hasChargen = !!controller.rules?.pack.chargen
  const tokens = useGame((s) => s.tokens)
  const characters = useGame((s) => s.characters)
  const [name, setName] = useState('')
  const [count, setCount] = useState(1)
  const [sheet, setSheet] = useState(hasChargen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<Spawned[]>([])

  const generate = async () => {
    setBusy(true); setError(null)
    try {
      const n = Math.max(1, Math.min(20, Math.floor(count) || 1))
      const names = name.trim() ? (n === 1 ? [name.trim()] : Array.from({ length: n }, (_, i) => `${name.trim()} ${i + 1}`)) : randomNames(packId, n)
      const specs = names.map((nm, i) => ({ name: nm, color: ENCOUNTER_COLORS[(Object.keys(tokens).length + i) % ENCOUNTER_COLORS.length]!, generateSheet: sheet && hasChargen }))
      setLast(await spawnNpcs(controller, specs, { hidden: true }))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const lastIds = last.map((s) => s.token.id)
  const alive = lastIds.filter((id) => tokens[id])
  const anyHidden = alive.some((id) => tokens[id]!.hidden)

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      <div className="grid2">
        <label>Name
          <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="random" />
            <button className="icon" aria-label="Random name" title="Random name" onClick={() => setName(randomName(packId))}>🎲</button>
          </div>
        </label>
        <label>Count<input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={sheet && hasChargen} disabled={!hasChargen} onChange={(e) => setSheet(e.target.checked)} /> Roll a character sheet{!hasChargen && <span className="muted small"> (pack has no chargen)</span>}</label>
      <button className="primary wide" disabled={busy || disabled} onClick={() => void generate()}>{busy ? 'Generating…' : `Generate ${count > 1 ? `${count} NPCs` : 'NPC'} (hidden)`}</button>
      {error && <p className="error small">{error}</p>}
      {alive.length > 0 && (
        <div>
          <div className="row" style={{ marginTop: 0 }}>
            <button onClick={() => void setHidden(controller, alive, !anyHidden)}>{anyHidden ? 'Reveal' : 'Hide'} {alive.length > 1 ? 'all' : ''}</button>
            <button className="danger" onClick={() => { void removeTokens(controller, alive); setLast([]) }}>Remove</button>
          </div>
          {last.filter((s) => tokens[s.token.id]).map((s) => {
            const c = s.character ? characters[s.character.id] ?? s.character : undefined
            return (
              <div key={s.token.id} style={{ marginTop: 'var(--sp-2)', padding: 'var(--sp-2)', background: 'var(--panel-2)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <span className="dot" style={{ background: s.token.color }} />
                  <strong style={{ flex: 1 }}>{s.token.name}</strong>
                  <span className="muted small">{tokens[s.token.id]?.hidden ? 'hidden' : 'visible'}</span>
                  <button className="tiny" onClick={() => useGame.getState().setSelectedToken(s.token.id)}>Select</button>
                </div>
                {c ? (
                  <dl style={{ margin: 'var(--sp-1) 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
                    {statBlock(controller.rules, c).map((l) => <StatRow key={l.label} label={l.label} value={l.value} />)}
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

// ------------------------------------------------------------------------------- Encounters

function Encounters({ controller, disabled }: { controller: GameController; disabled: boolean }) {
  const gameId = controller.connection.gameId
  const tokens = useGame((s) => s.tokens)
  const hasChargen = !!controller.rules?.pack.chargen
  const [list, setList] = useState<Encounter[]>(() => loadEncounters(gameId))
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => saveEncounters(gameId, list), [gameId, list])

  const update = (id: string, patch: (e: Encounter) => Encounter) => setList((l) => l.map((e) => (e.id === id ? patch(e) : e)))

  const place = async (e: Encounter) => {
    setBusy(e.id)
    try {
      const specs = e.rows.flatMap((r) => {
        const n = Math.max(0, Math.floor(r.count || 0))
        const base = r.name.trim() || 'Creature'
        return Array.from({ length: n }, (_, i) => ({ name: n > 1 ? `${base} ${i + 1}` : base, color: r.color, generateSheet: r.generateSheet && hasChargen }))
      })
      if (!specs.length) return
      const spawned = await spawnNpcs(controller, specs, { hidden: true })
      update(e.id, (x) => ({ ...x, placed: [...x.placed.filter((id) => tokens[id]), ...spawned.map((s) => s.token.id)] }))
    } finally { setBusy(null) }
  }
  const placedAlive = (e: Encounter): TokenId[] => e.placed.filter((id) => !!tokens[id])

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      {list.length === 0 && <p className="muted small">Save a group of creatures to drop on the table in one tap.</p>}
      <ul className="list">
        {list.map((e) => {
          const alive = placedAlive(e)
          const anyHidden = alive.some((id) => tokens[id]!.hidden)
          const open = editing === e.id
          return (
            <li key={e.id} style={{ display: 'block', padding: 'var(--sp-2)', background: open ? 'var(--panel-2)' : undefined, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minHeight: 'var(--control)' }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{e.name || 'Encounter'} <span className="muted small">· {encounterSize(e)} token{encounterSize(e) === 1 ? '' : 's'}{alive.length ? ` · ${alive.length} on table` : ''}</span></span>
                <button className="tiny" style={{ minHeight: 'var(--control)' }} onClick={() => setEditing(open ? null : e.id)}>{open ? 'Done' : 'Edit'}</button>
              </div>
              <div className="row" style={{ marginTop: 'var(--sp-1)' }}>
                <button className="primary" disabled={disabled || busy === e.id || encounterSize(e) === 0} onClick={() => void place(e)}>{busy === e.id ? 'Placing…' : 'Place (hidden)'}</button>
                {alive.length > 0 && <>
                  <button onClick={() => void setHidden(controller, alive, !anyHidden)}>{anyHidden ? 'Reveal all' : 'Hide all'}</button>
                  <button className="danger" onClick={() => { void removeTokens(controller, alive); update(e.id, (x) => ({ ...x, placed: [] })) }}>Remove</button>
                </>}
              </div>
              {open && <EncounterEditor e={e} hasChargen={hasChargen} onChange={(next) => update(e.id, () => next)} onDelete={() => { setList((l) => l.filter((x) => x.id !== e.id)); setEditing(null) }} />}
            </li>
          )
        })}
      </ul>
      <button className="wide" onClick={() => { const e = newEncounter(list.length); setList((l) => [...l, e]); setEditing(e.id) }}>+ New encounter</button>
    </div>
  )
}

function EncounterEditor({ e, hasChargen, onChange, onDelete }: { e: Encounter; hasChargen: boolean; onChange(e: Encounter): void; onDelete(): void }) {
  const [confirm, setConfirm] = useState(false)
  const setRow = (id: string, patch: Partial<EncounterRow>) => onChange({ ...e, rows: e.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  return (
    <div className="props">
      <label>Encounter name<input value={e.name} onChange={(ev) => onChange({ ...e, name: ev.target.value })} /></label>
      {e.rows.map((r) => (
        <div key={r.id} style={{ display: 'grid', gap: 'var(--sp-1)', paddingBottom: 'var(--sp-2)', borderBottom: '1px dashed var(--border)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'end' }}>
            <label style={{ flex: 1, margin: 0 }}>Creature<input value={r.name} onChange={(ev) => setRow(r.id, { name: ev.target.value })} placeholder="Goblin" /></label>
            <label style={{ width: 72, margin: 0 }}>Count<input type="number" min={0} max={30} value={r.count} onChange={(ev) => setRow(r.id, { count: Number(ev.target.value) })} /></label>
            <button className="icon" aria-label="Remove row" onClick={() => onChange({ ...e, rows: e.rows.filter((x) => x.id !== r.id) })}>🗑</button>
          </div>
          <div className="swatches">
            {ENCOUNTER_COLORS.map((c) => <button key={c} className={`swatch ${c === r.color ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setRow(r.id, { color: c })} />)}
          </div>
          <label className="check"><input type="checkbox" checked={r.generateSheet && hasChargen} disabled={!hasChargen} onChange={(ev) => setRow(r.id, { generateSheet: ev.target.checked })} /> Roll a sheet for each</label>
        </div>
      ))}
      <div className="row" style={{ marginTop: 0 }}>
        <button onClick={() => onChange({ ...e, rows: [...e.rows, newRow(e.rows.length)] })}>+ Row</button>
        <span className="spacer" />
        {confirm
          ? <><button className="danger" onClick={onDelete}>Really delete</button><button onClick={() => setConfirm(false)}>Keep</button></>
          : <button className="danger" onClick={() => setConfirm(true)}>Delete encounter</button>}
      </div>
    </div>
  )
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
