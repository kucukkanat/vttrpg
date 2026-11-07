/**
 * GM prep for packs with a creature compendium: search and preview stat blocks, keep edited or
 * homebrew stat blocks as game templates, and the picker the NPC generator and encounter rows
 * use. Stat blocks render with the pack's creature sheet layout through the generic SheetView.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Character, CreatureTemplate } from '@/core/doc'
import type { CharacterId } from '@/core/ids'
import type { CreatureDocument, CreatureEntry } from '@/core/pack'
import { loadCreatures, SheetView, type RulesEngine } from '@/rules'
import { getPath } from '@/rules/expr'
import { newSeed } from '@/dice'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { pushToast } from '../toasts'
import { setDataPath } from '../sheetEdit'
import { gameRef, packRef, resolveCreature, templateFrom, type ResolvedCreature } from '../prep/encounters'
import { CR_STEPS, formatCr, searchCreatures } from '../prep/creatureSearch'

export interface Compendium {
  status: 'none' | 'loading' | 'ready' | 'error'
  creatures: CreatureEntry[]
  documents: CreatureDocument[]
  error?: string
}

/** The pack's compendium, fetched the first time a component asks for it. */
export function useCompendium(rules: RulesEngine | null): Compendium {
  const has = !!rules?.pack.manifest.creatures?.files.length
  const [state, setState] = useState<Compendium>(() => ({ status: has ? 'loading' : 'none', creatures: [], documents: [] }))
  useEffect(() => {
    if (!rules || !has) return
    let live = true
    loadCreatures(rules.pack).then(
      (c) => { if (live) setState({ status: 'ready', creatures: c.creatures, documents: c.documents }) },
      (e: unknown) => { if (live) setState({ status: 'error', creatures: [], documents: [], error: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { live = false }
  }, [rules, has])
  return state
}

function sourceTitle(documents: CreatureDocument[], key: string): string {
  if (key === 'homebrew') return 'Homebrew'
  return documents.find((d) => d.key === key)?.title ?? key
}

/** One line per CC-BY source the browser draws on, as the licences ask. */
export function Attribution({ documents }: { documents: CreatureDocument[] }) {
  if (!documents.length) return null
  return (
    <p className="muted small" style={{ margin: 'var(--sp-2) 0 0', overflowWrap: 'anywhere' }}>
      Stat blocks: {documents.map((d, i) => (
        <span key={d.key}>{i > 0 && '; '}{d.title ?? d.name} by Wizards of the Coast LLC, <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">{d.license}</a>{d.url && <> (<a href={d.url} target="_blank" rel="noreferrer">source</a>)</>}</span>
      ))}. Converted via Open5e. See the pack's LICENSE.md.
    </p>
  )
}

/** "CR 1/4 · 50 XP · AC 15 · HP 10" from the pack's creature paths. */
export function creatureSummary(rules: RulesEngine, data: Record<string, unknown>): string {
  const c = rules.pack.manifest.creatures
  if (!c) return ''
  const at = (p: string | undefined) => (p ? getPath(data, p.split('.')) : undefined)
  const parts: string[] = []
  const cr = at(c.crText) ?? (typeof at(c.cr) === 'number' ? formatCr(at(c.cr) as number) : undefined)
  if (cr !== undefined) parts.push(`CR ${String(cr)}`)
  const xp = at(c.xp)
  if (typeof xp === 'number') parts.push(`${xp} XP`)
  const ac = at(c.ac)
  if (typeof ac === 'number') parts.push(`AC ${ac}`)
  const hp = at(c.hp)
  const hpMax = typeof hp === 'number' ? hp : getPath(hp, ['max'])
  if (typeof hpMax === 'number') parts.push(`HP ${hpMax}${typeof at(c.hpFormula) === 'string' && at(c.hpFormula) ? ` (${String(at(c.hpFormula))})` : ''}`)
  return parts.join(' · ')
}

/** The stat block through the pack's creature layout. Editable when `onChange` is given. */
export function StatBlock({ rules, creature, onChange }: { rules: RulesEngine; creature: Pick<ResolvedCreature, 'name' | 'data'>; onChange?(path: string, value: unknown): void }) {
  const layout = rules.pack.manifest.creatures?.sheet
  const character: Character = useMemo(() => ({ id: 'preview' as CharacterId, name: creature.name, sheet: layout, data: creature.data }), [creature, layout])
  const schema = (layout && rules.pack.sheets?.[layout]) || rules.pack.sheet
  // Rolls from a stat block that is not on the table yet stay with the GM: a toast, not chat.
  const roll = (formula: string, label: string) => {
    rules.roll(formula, newSeed(), { character }).then(
      (r) => pushToast({ text: `${creature.name} · ${label}: ${r.total}`, ttl: 6000 }),
      (e: unknown) => pushToast({ text: `${label}: ${e instanceof Error ? e.message : String(e)}` }),
    )
  }
  return (
    <div className="sheet" style={{ maxHeight: onChange ? undefined : 360, overflow: onChange ? undefined : 'auto' }}>
      <SheetView schema={schema} character={character} readOnly={!onChange} compute={(expr) => rules.evaluateNow(expr, character)} onChange={onChange ?? (() => {})} onRoll={roll} />
    </div>
  )
}

/**
 * Search box plus results; `onPick` gets the creature ref. Game templates match too, listed with
 * the compendium hits under the same query.
 */
export function CreaturePicker({ rules, compendium, onPick, onEdit, pickLabel = 'Pick', autoFocus }: {
  rules: RulesEngine
  compendium: Compendium
  onPick(ref: string, name: string): void
  /** Offer "Edit stat block" on the preview. */
  onEdit?(ref: string): void
  pickLabel?: string
  autoFocus?: boolean
}) {
  const templates = useGame((s) => s.creatures)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [crMin, setCrMin] = useState<number | undefined>(undefined)
  const [crMax, setCrMax] = useState<number | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(null)

  const own = useMemo(() => Object.values(templates).filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [templates, query])
  const { results, total } = useMemo(
    () => (source === 'game' ? { results: [], total: 0 } : searchCreatures(compendium.creatures, { query, source, crMin, crMax, limit: 30 })),
    [compendium.creatures, query, source, crMin, crMax],
  )
  const crOptions = CR_STEPS.map((c) => <option key={c} value={c}>{formatCr(c)}</option>)
  const shown = preview ? resolveCreature(preview, compendium.creatures, templates) : undefined

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search creatures (goblin, dragon, undead…)" aria-label="Search creatures" autoFocus={autoFocus} />
      <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" style={{ flex: '1 1 8em' }}>
          <option value="">All sources</option>
          <option value="game">This game's stat blocks</option>
          {compendium.documents.map((d) => <option key={d.key} value={d.key}>{d.title ?? d.name}</option>)}
        </select>
        <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center', margin: 0 }}>CR
          <select value={crMin ?? ''} onChange={(e) => setCrMin(e.target.value === '' ? undefined : Number(e.target.value))} aria-label="Lowest CR"><option value="">any</option>{crOptions}</select>
          to
          <select value={crMax ?? ''} onChange={(e) => setCrMax(e.target.value === '' ? undefined : Number(e.target.value))} aria-label="Highest CR"><option value="">any</option>{crOptions}</select>
        </label>
      </div>
      {compendium.status === 'loading' && <p className="muted small">Loading the compendium…</p>}
      {compendium.status === 'error' && <p className="error small">Could not load creatures: {compendium.error}</p>}
      <ul className="list" style={{ maxHeight: 280, overflow: 'auto' }}>
        {(source === '' || source === 'game') && own.map((t) => (
          <PickRow key={t.id} name={t.name} meta={`${creatureSummary(rules, t.data)} · this game`} open={preview === gameRef(t.id)}
            onPreview={() => setPreview(preview === gameRef(t.id) ? null : gameRef(t.id))} onPick={() => onPick(gameRef(t.id), t.name)} pickLabel={pickLabel} />
        ))}
        {results.map((c) => (
          <PickRow key={c.key} name={c.name} meta={`CR ${formatCr(c.cr)} · ${c.xp ?? 0} XP · ${[c.size, c.type].filter(Boolean).join(' ')} · ${sourceTitle(compendium.documents, c.source)}`} open={preview === packRef(c.key)}
            onPreview={() => setPreview(preview === packRef(c.key) ? null : packRef(c.key))} onPick={() => onPick(packRef(c.key), c.name)} pickLabel={pickLabel} />
        ))}
      </ul>
      {total > results.length && <p className="muted small" style={{ margin: 0 }}>Showing {results.length} of {total}; type more to narrow it down.</p>}
      {compendium.status === 'ready' && total === 0 && own.length === 0 && <p className="muted small" style={{ margin: 0 }}>No creature matches.</p>}
      {shown && (
        <div style={{ padding: 'var(--sp-2)', background: 'var(--panel-2)', borderRadius: 'var(--r-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <strong style={{ flex: 1 }}>{shown.name}</strong>
            {onEdit && <button className="tiny" onClick={() => onEdit(shown.ref)} title={shown.custom ? "Edit this game's stat block" : 'Copy into this game and edit (reskins, homebrew)'}>Edit stat block</button>}
            <button className="tiny" onClick={() => setPreview(null)}>Close</button>
          </div>
          <p className="muted small" style={{ margin: '2px 0 var(--sp-1)' }}>{creatureSummary(rules, shown.data)} · {sourceTitle(compendium.documents, shown.source)}</p>
          <StatBlock rules={rules} creature={shown} />
        </div>
      )}
    </div>
  )
}

function PickRow({ name, meta, open, onPreview, onPick, pickLabel }: { name: string; meta: string; open: boolean; onPreview(): void; onPick(): void; pickLabel: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '4px var(--sp-1)', cursor: 'default' }}>
      <button type="button" className="link" style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, color: 'inherit' }} aria-expanded={open} onClick={onPreview} title="Show the stat block">
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span className="muted small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      </button>
      <button type="button" className="tiny" onClick={onPick}>{pickLabel}</button>
    </li>
  )
}

/** Make a game template from a compendium entry (or reuse the game one) and return its id. */
export async function ensureTemplate(controller: GameController, ref: string, compendium: Compendium): Promise<string | null> {
  if (ref.startsWith('game:')) return ref.slice(5)
  const creature = resolveCreature(ref, compendium.creatures, useGame.getState().creatures)
  if (!creature) return null
  const t = templateFrom(creature)
  await controller.dispatch({ type: 'creature.upsert', creature: t })
  return t.id
}

/** Editing one game template: name plus the full stat block form. Each placed token keeps its own copy. */
export function StatBlockEditor({ controller, templateId, compendium, onClose }: { controller: GameController; templateId: string; compendium: Compendium; onClose(): void }) {
  const rules = controller.rules
  const template = useGame((s) => s.creatures[templateId])
  const [confirm, setConfirm] = useState(false)
  if (!rules || !template) return null
  const save = (next: CreatureTemplate) => void controller.dispatch({ type: 'creature.upsert', creature: { ...next, updatedAt: Date.now() } })
  const onChange = (path: string, value: unknown) => {
    if (path === 'name') save({ ...template, name: String(value) })
    else save({ ...template, data: setDataPath(template.data, path, value) })
  }
  return (
    <div style={{ padding: 'var(--sp-2)', background: 'var(--panel-2)', borderRadius: 'var(--r-sm)', marginTop: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <strong style={{ flex: 1 }}>Edit stat block: {template.name}</strong>
        <button className="tiny primary" onClick={onClose}>Done</button>
      </div>
      <p className="muted small" style={{ margin: '2px 0 var(--sp-1)' }}>
        {creatureSummary(rules, template.data)} · {template.from ? `copied from ${sourceTitle(compendium.documents, template.source ?? '')}` : 'homebrew'}. Changes apply to tokens placed from now on; tokens already on the table keep their own sheet.
      </p>
      <StatBlock rules={rules} creature={template} onChange={onChange} />
      <div className="row">
        <span className="spacer" />
        {confirm
          ? <><button className="danger" onClick={() => { void controller.dispatch({ type: 'creature.remove', creature: template.id }); onClose() }}>Really delete</button><button onClick={() => setConfirm(false)}>Keep</button></>
          : <button className="danger" onClick={() => setConfirm(true)}>Delete stat block</button>}
      </div>
    </div>
  )
}

/** The Creatures section: browse, preview, copy into the game to edit, start a homebrew one. */
export function CreatureBrowser({ controller, compendium, onEdit, onAdd }: {
  controller: GameController
  compendium: Compendium
  onEdit(templateId: string): void
  /** Add the creature to an encounter (the panel picks which). */
  onAdd(ref: string, name: string): void
}) {
  const rules = controller.rules
  const [busy, setBusy] = useState(false)
  if (!rules) return null
  const edit = async (ref: string) => {
    setBusy(true)
    try {
      const id = await ensureTemplate(controller, ref, compendium)
      if (id) onEdit(id)
    } finally { setBusy(false) }
  }
  const homebrew = async () => {
    const base = compendium.creatures[0]
    const data = base ? structuredClone(base.data) : {}
    const t: CreatureTemplate = { id: crypto.randomUUID(), name: 'New creature', source: 'homebrew', data, updatedAt: Date.now() }
    await controller.dispatch({ type: 'creature.upsert', creature: t })
    onEdit(t.id)
  }
  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      <CreaturePicker rules={rules} compendium={compendium} pickLabel="Add" onPick={onAdd} onEdit={(ref) => { if (!busy) void edit(ref) }} />
      <GameTemplates disabled={busy} onEdit={(ref) => void edit(ref)} />
      <div className="row" style={{ marginTop: 0 }}>
        <button onClick={() => void homebrew()} disabled={compendium.status !== 'ready'} title="Start from a copy of the first stat block and rewrite it">+ Homebrew stat block</button>
      </div>
      <Attribution documents={compendium.documents} />
    </div>
  )
}

/** The game's own stat blocks, each one tap from its editor. */
function GameTemplates({ disabled, onEdit }: { disabled: boolean; onEdit(ref: string): void }) {
  const templates = useGame((s) => s.creatures)
  const list = Object.values(templates).sort((a, b) => a.name.localeCompare(b.name))
  if (!list.length) return null
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
      <span className="muted small">This game's stat blocks</span>
      <ul className="list">
        {list.map((t) => (
          <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '4px var(--sp-1)', cursor: 'default' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            <button className="tiny" disabled={disabled} onClick={() => onEdit(gameRef(t.id))}>Edit stat block</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
