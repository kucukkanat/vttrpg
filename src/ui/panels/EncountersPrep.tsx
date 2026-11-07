/**
 * Encounters in the Prep panel. They live in the shared document (`encounters`) so they follow
 * the GM across devices; ones an older version left in this device's localStorage are moved in
 * once. Rows point at a compendium creature or a game stat block, with overrides, hit point mode
 * and friendlies; the pack's XP budget drives the difficulty meter.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Encounter, EncounterRow } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { pushToast } from '../toasts'
import { Swatch } from '../components'
import { setHidden, removeTokens } from '../prep/npc'
import {
  clearLegacyEncounters, detectParty, difficultyArithmetic, difficultyLabel, encounterDifficulty, encounterSize, ENCOUNTER_COLORS, FRIENDLY_COLOR,
  loadLegacyEncounters, newEncounter, newRow, placedGroups, resolveCreature, rowName, sortEncounters,
} from '../prep/encounters'
import { groupInitiative, placeRows } from '../prep/placeCreatures'
import { getPath } from '@/rules/expr'
import { CreaturePicker, creatureSummary, ensureTemplate, type Compendium } from './CreaturesPrep'

export function Encounters({ controller, disabled, compendium, open, setOpen, onEditTemplate }: {
  controller: GameController
  disabled: boolean
  compendium: Compendium
  /** The encounter whose editor is open (the creature browser adds to it). */
  open: string | null
  setOpen(id: string | null): void
  onEditTemplate(id: string): void
}) {
  const gameId = controller.connection.gameId
  const isGm = controller.connection.isGm
  const tokens = useGame((s) => s.tokens)
  const stored = useGame((s) => s.encounters)
  const templates = useGame((s) => s.creatures)
  const [busy, setBusy] = useState<string | null>(null)
  const list = useMemo(() => sortEncounters(stored), [stored])

  // One-time move of this device's old localStorage encounters into the game.
  useEffect(() => {
    if (!isGm) return
    const legacy = loadLegacyEncounters(gameId)
    if (!legacy.length) return
    const have = useGame.getState().encounters
    void (async () => {
      for (const e of legacy) if (!have[e.id]) await controller.dispatch({ type: 'encounter.upsert', encounter: e })
      clearLegacyEncounters(gameId)
      pushToast({ text: `Moved ${legacy.length} saved encounter${legacy.length === 1 ? '' : 's'} into the game`, key: 'encounters-migrated' })
    })()
  }, [controller, gameId, isGm])

  const save = (e: Encounter) => void controller.dispatch({ type: 'encounter.upsert', encounter: e })
  const alive = (e: Encounter): TokenId[] => e.placed.filter((id) => !!tokens[id])

  const place = async (e: Encounter) => {
    setBusy(e.id)
    try {
      const { placed, missing } = await placeRows(controller, e.rows, compendium.creatures, templates)
      if (missing.length) pushToast({ text: `Skipped ${missing.join(', ')}: stat block not found` })
      const fresh = useGame.getState().encounters[e.id] ?? e
      const placedRows: Record<string, TokenId[]> = {}
      for (const p of placed) placedRows[p.row.id] = [...(placedRows[p.row.id] ?? []), ...p.tokens]
      // A new placement is what Join initiative groups; tokens of earlier ones stay in `placed`.
      save({ ...fresh, placed: [...alive(fresh), ...placed.flatMap((p) => p.tokens)], placedRows })
    } catch (err) {
      pushToast({ text: `Place failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally { setBusy(null) }
  }

  /** Each row of the last placement rolls once and joins the turn order as one initiative group. */
  const joinInitiative = async (e: Encounter) => {
    const s = useGame.getState()
    const groups = placedGroups(e, (id) => !!s.tokens[id])
    const n = await groupInitiative(controller, groups)
    if (n) pushToast({ text: `${n} token${n === 1 ? '' : 's'} joined initiative in ${groups.length} group${groups.length === 1 ? '' : 's'}`, key: 'initiative' })
  }

  const add = () => {
    const e = newEncounter(list.length)
    save(e)
    setOpen(e.id)
  }

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      {list.length === 0 && <p className="muted small">Save a group of creatures to drop on the table in one tap. Encounters are saved in the game, so they follow you to other devices.</p>}
      <ul className="list">
        {list.map((e) => {
          const live = alive(e)
          const anyHidden = live.some((id) => tokens[id]!.hidden)
          const isOpen = open === e.id
          return (
            <li key={e.id} style={{ display: 'block', padding: 'var(--sp-2)', background: isOpen ? 'var(--panel-2)' : undefined, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minHeight: 'var(--control)' }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{e.name || 'Encounter'} <span className="muted small">· {encounterSize(e)} token{encounterSize(e) === 1 ? '' : 's'}{live.length ? ` · ${live.length} on table` : ''}</span></span>
                <button className="tiny" style={{ minHeight: 'var(--control)' }} onClick={() => setOpen(isOpen ? null : e.id)}>{isOpen ? 'Done' : 'Edit'}</button>
              </div>
              <div className="row" style={{ marginTop: 'var(--sp-1)' }}>
                <button className="primary" disabled={disabled || busy === e.id || encounterSize(e) === 0} onClick={() => void place(e)}>{busy === e.id ? 'Placing…' : 'Place (hidden)'}</button>
                {live.length > 0 && <>
                  <button onClick={() => void setHidden(controller, live, !anyHidden)}>{anyHidden ? 'Reveal all' : 'Hide all'}</button>
                  <button onClick={() => void joinInitiative(e)} title="One roll per row; the group shares it">Join initiative</button>
                  <button className="danger" onClick={() => { void removeTokens(controller, live); save({ ...e, placed: [], placedRows: {} }) }}>Remove</button>
                </>}
              </div>
              {!isOpen && <DifficultyMeter controller={controller} encounter={e} compendium={compendium} compact />}
              {isOpen && (
                <EncounterEditor controller={controller} e={e} compendium={compendium} onChange={save} onEditTemplate={onEditTemplate}
                  onDelete={() => { void controller.dispatch({ type: 'encounter.remove', encounter: e.id }); setOpen(null) }} />
              )}
            </li>
          )
        })}
      </ul>
      <button className="wide" onClick={add}>+ New encounter</button>
    </div>
  )
}

function EncounterEditor({ controller, e, compendium, onChange, onDelete, onEditTemplate }: {
  controller: GameController
  e: Encounter
  compendium: Compendium
  onChange(e: Encounter): void
  onDelete(): void
  onEditTemplate(id: string): void
}) {
  const rules = controller.rules
  const hasChargen = !!rules?.pack.chargen
  const hasCreatures = !!rules?.pack.manifest.creatures
  const templates = useGame((s) => s.creatures)
  const [confirm, setConfirm] = useState(false)
  const [picking, setPicking] = useState<string | 'new' | null>(null)
  const setRow = (id: string, patch: Partial<EncounterRow>) => onChange({ ...e, rows: e.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const setOverride = (r: EncounterRow, key: keyof NonNullable<EncounterRow['overrides']>, value: string | number | undefined) => {
    const overrides = { ...(r.overrides ?? {}) } as Record<string, unknown>
    if (value === undefined || value === '') delete overrides[key]
    else overrides[key] = value
    setRow(r.id, { overrides: Object.keys(overrides).length ? (overrides as EncounterRow['overrides']) : undefined })
  }
  const pick = (ref: string) => {
    if (picking === 'new') onChange({ ...e, rows: [...e.rows, newRow(e.rows.length, { creatureRef: ref })] })
    else if (picking) setRow(picking, { creatureRef: ref })
    setPicking(null)
  }
  const editStatBlock = async (r: EncounterRow) => {
    if (!r.creatureRef) return
    const id = await ensureTemplate(controller, r.creatureRef, compendium)
    if (!id) return
    if (r.creatureRef !== `game:${id}`) setRow(r.id, { creatureRef: `game:${id}` })
    onEditTemplate(id)
  }
  const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v))

  return (
    <div className="props">
      <label>Encounter name<input value={e.name} onChange={(ev) => onChange({ ...e, name: ev.target.value })} /></label>
      {e.rows.map((r) => {
        const creature = resolveCreature(r.creatureRef, compendium.creatures, templates)
        return (
          <div key={r.id} style={{ display: 'grid', gap: 'var(--sp-1)', paddingBottom: 'var(--sp-2)', borderBottom: '1px dashed var(--border)' }}>
            {r.creatureRef ? (
              <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 10em', minWidth: 0 }}>
                  <strong>{creature?.name ?? (compendium.status === 'loading' ? 'Loading…' : 'Missing stat block')}</strong>
                  {creature?.custom && <span className="muted small"> · this game</span>}
                  {creature && rules && <span className="muted small" style={{ display: 'block' }}>{creatureSummary(rules, creature.data)}</span>}
                </span>
                <button className="tiny" onClick={() => setPicking(picking === r.id ? null : r.id)}>Change</button>
                <button className="tiny" disabled={!creature} onClick={() => void editStatBlock(r)}>Edit stat block</button>
              </div>
            ) : (
              <label style={{ margin: 0 }}>Creature<input value={r.overrides?.name ?? ''} onChange={(ev) => setOverride(r, 'name', ev.target.value)} placeholder="Goblin" /></label>
            )}
            {picking === r.id && rules && <CreaturePicker rules={rules} compendium={compendium} onPick={pick} autoFocus />}
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'end', flexWrap: 'wrap' }}>
              <label style={{ width: 72, margin: 0 }}>Count<input type="number" min={0} max={30} value={r.count} onChange={(ev) => setRow(r.id, { count: Number(ev.target.value) })} /></label>
              {r.creatureRef && (
                <label style={{ width: 110, margin: 0 }}>Hit points
                  <select value={r.hpMode ?? 'average'} onChange={(ev) => setRow(r.id, { hpMode: ev.target.value as EncounterRow['hpMode'] })}>
                    <option value="average">Average</option>
                    <option value="roll">Roll each</option>
                  </select>
                </label>
              )}
              <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={!!r.friendly} onChange={(ev) => setRow(r.id, { friendly: ev.target.checked, ...(ev.target.checked && r.color !== FRIENDLY_COLOR ? { color: FRIENDLY_COLOR } : {}) })} /> Friendly</label>
              <span className="spacer" />
              <button className="icon" aria-label="Remove row" onClick={() => onChange({ ...e, rows: e.rows.filter((x) => x.id !== r.id) })}>🗑</button>
            </div>
            <div className="swatches">
              {ENCOUNTER_COLORS.map((c) => <Swatch key={c} color={c} on={c === r.color} onPick={(color) => setRow(r.id, { color })} />)}
            </div>
            {r.creatureRef ? (
              <details>
                <summary className="disclosure small">Overrides{r.overrides ? ` (${Object.keys(r.overrides).join(', ')})` : ''}</summary>
                <div className="grid2">
                  <label>Name<input value={r.overrides?.name ?? ''} placeholder={creature?.name ?? ''} onChange={(ev) => setOverride(r, 'name', ev.target.value)} /></label>
                  <label>AC<input type="number" value={r.overrides?.ac ?? ''} placeholder={String(acOf(controller, creature?.data) ?? '')} onChange={(ev) => setOverride(r, 'ac', numOrUndef(ev.target.value))} /></label>
                  <label>HP<input type="number" min={1} value={r.overrides?.hp ?? ''} placeholder={r.hpMode === 'roll' ? 'rolled' : 'average'} onChange={(ev) => setOverride(r, 'hp', numOrUndef(ev.target.value))} /></label>
                </div>
                <label>Notes<input value={r.overrides?.notes ?? ''} placeholder="Added to each token's notes" onChange={(ev) => setOverride(r, 'notes', ev.target.value)} /></label>
              </details>
            ) : (
              hasChargen && <label className="check"><input type="checkbox" checked={!!r.generateSheet} onChange={(ev) => setRow(r.id, { generateSheet: ev.target.checked })} /> Roll a sheet for each</label>
            )}
          </div>
        )
      })}
      {picking === 'new' && rules && <CreaturePicker rules={rules} compendium={compendium} onPick={pick} pickLabel="Add" autoFocus />}
      <div className="row" style={{ marginTop: 0 }}>
        {hasCreatures && <button className={e.rows.length === 0 ? 'primary' : undefined} onClick={() => setPicking(picking === 'new' ? null : 'new')}>{picking === 'new' ? 'Cancel' : '+ Creature'}</button>}
        <button onClick={() => onChange({ ...e, rows: [...e.rows, newRow(e.rows.length)] })}>{hasCreatures ? '+ Plain mini' : '+ Row'}</button>
        <span className="spacer" />
        {confirm
          ? <><button className="danger" onClick={onDelete}>Really delete</button><button onClick={() => setConfirm(false)}>Keep</button></>
          : <button className="danger" onClick={() => setConfirm(true)}>Delete encounter</button>}
      </div>
      <DifficultyMeter controller={controller} encounter={e} compendium={compendium} onParty={(party) => onChange({ ...e, party })} />
    </div>
  )
}

function acOf(controller: GameController, data: Record<string, unknown> | undefined): number | undefined {
  const path = controller.rules?.pack.manifest.creatures?.ac
  const v = data && path ? getPath(data, path.split('.')) : undefined
  return typeof v === 'number' ? v : undefined
}

/**
 * The pack's difficulty bands for this encounter: budgets per band for the party, creature XP
 * summed with friendlies left out, and the arithmetic spelled out. Hidden for packs without one.
 */
function DifficultyMeter({ controller, encounter, compendium, compact, onParty }: {
  controller: GameController
  encounter: Encounter
  compendium: Compendium
  compact?: boolean
  onParty?(party: Encounter['party']): void
}) {
  const rules = controller.rules
  const enc = rules?.pack.encounter
  const tokens = useGame((s) => s.tokens)
  const characters = useGame((s) => s.characters)
  const templates = useGame((s) => s.creatures)
  const scene = useGame((s) => s.meta?.activeScene)
  if (!rules || !enc) return null
  const party = detectParty(enc, tokens, characters, scene, encounter.party)
  const xpPath = enc.xp.split('.')
  const rows = encounter.rows.map((r) => {
    const c = resolveCreature(r.creatureRef, compendium.creatures, templates)
    const xp = c ? getPath(c.data, xpPath) : undefined
    return { name: rowName(r, c), count: r.count, xp: typeof xp === 'number' ? xp : 0, friendly: r.friendly }
  })
  const d = encounterDifficulty(enc, party, rows)
  const hasParty = party.levels.length > 0
  const label = difficultyLabel(d, hasParty)
  const top = Math.max(1, d.budgets[d.budgets.length - 1]?.xp ?? 1)
  const pct = Math.min(100, (d.total / top) * 100)
  const bar = (
    <div aria-hidden style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: d.over ? 'var(--danger, #f28b82)' : 'var(--accent)' }} />
      {d.budgets.slice(0, -1).map((b) => <div key={b.id} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(b.xp / top) * 100}%`, width: 1, background: 'var(--panel, #000)' }} />)}
    </div>
  )
  if (compact) {
    if (!rows.some((r) => r.count > 0 && r.xp)) return null
    return (
      <div className="small" style={{ marginTop: 'var(--sp-1)' }} aria-label={`Difficulty ${label}, ${d.total} XP`}>
        <span className="muted">Difficulty</span> <strong>{label}</strong> <span className="muted">· {d.total} XP{hasParty ? ` of ${top} (${d.budgets[d.budgets.length - 1]!.name})` : ''}</span>
        {hasParty && bar}
      </div>
    )
  }
  const partyText = party.from === 'none'
    ? 'No player characters with a level found.'
    : `${party.size} character${party.size === 1 ? '' : 's'} (${party.from === 'manual' ? `level ${party.level}, set by hand` : `levels ${party.levels.join(', ')}`})`
  return (
    <div style={{ padding: 'var(--sp-2)', background: 'var(--panel)', borderRadius: 'var(--r-sm)', marginTop: 'var(--sp-1)' }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
        <span className="muted small">Difficulty</span>
        <strong style={{ flex: 1 }}>{label}</strong>
        <span className="small">{d.total} XP</span>
      </div>
      {hasParty && bar}
      <p className="small" style={{ margin: 'var(--sp-1) 0 0' }}>Party: {partyText}</p>
      {hasParty && <p className="small" style={{ margin: '2px 0 0' }}>Budget: {d.budgets.map((b) => `${b.name} ${b.xp}`).join(' · ')}</p>}
      <p className="small" style={{ margin: '2px 0 0', overflowWrap: 'anywhere' }}>Creatures: {difficultyArithmetic(d)}{d.friendlies ? ` (${d.friendlies} friendly left out)` : ''}</p>
      {onParty && (
        <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'end', marginTop: 'var(--sp-1)', flexWrap: 'wrap' }}>
          <label style={{ width: 80, margin: 0 }} className="small">Party size<input type="number" min={1} max={12} value={encounter.party?.size ?? ''} placeholder={String(party.from === 'sheets' ? party.size : 4)} onChange={(ev) => onParty(partyFrom(ev.target.value, encounter.party?.level ?? (party.level || 1)))} /></label>
          <label style={{ width: 80, margin: 0 }} className="small">Level<input type="number" min={1} max={20} value={encounter.party?.level ?? ''} placeholder={String(party.level || 1)} onChange={(ev) => onParty(partyFrom(String(encounter.party?.size ?? (party.size || 4)), Number(ev.target.value) || 1))} /></label>
          {encounter.party && <button className="tiny" onClick={() => onParty(undefined)}>From sheets</button>}
        </div>
      )}
      <p className="muted small" style={{ margin: 'var(--sp-1) 0 0' }}>{enc.source}</p>
    </div>
  )
}

function partyFrom(size: string, level: number): Encounter['party'] {
  const n = Math.floor(Number(size))
  return n > 0 ? { size: n, level: Math.max(1, Math.floor(level)) } : undefined
}
