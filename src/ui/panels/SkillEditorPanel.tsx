/**
 * GM skill editor. Lists the pack's skills (read-only; "Override" edits a replacement with the
 * same id, "Duplicate" a copy with a new one) and this game's custom skills (editable); the form
 * (`src/ui/skilleditor`) validates live with the pack loader's guard. Create / Save dispatch
 * `skill.upsert`, Delete `skill.remove`; Test dry-runs `resolveSkill` against a dummy character
 * without touching the document. A JSON pane imports and exports skills so they can move between
 * games or into a pack folder.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { Character } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import {
  describeTarget,
  duplicateForm,
  emptyForm,
  formFromSkill,
  overrideForm,
  skillFromForm,
  skillFromJson,
  skillToJson,
  uniqueSlug,
  validateForm,
  type SkillForm,
} from '../skilleditor/model'
import { SkillFormView } from '../skilleditor/SkillForm'
import { takeSkillEditorRequest, useSkillEditorRequests, type SkillEditorRequest } from '../skilleditor/requests'
import { withSkill } from '../skillbar/tokenSkills'
import type { TokenId } from '@/core/ids'

type View =
  | { kind: 'list' }
  | { kind: 'edit'; form: SkillForm; saved: string; editingId: string | null }

interface TestResult {
  ok: boolean
  lines: string[]
}

/** A character with every `{ current, max }` pair set to 10 so costs can be paid and saves have a target. */
export function testDummy(blank: Character): Character {
  const data = structuredClone(blank.data)
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'current' in v && 'max' in v) data[k] = { current: 10, max: 10 }
  }
  return { ...blank, data }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Pack skills use icon names ("flame"); only glyph-like icons (emoji, a symbol) are shown inline. */
const glyph = (icon: string | undefined): string => (icon && !/^[a-z0-9-]+$/i.test(icon) ? `${icon} ` : '')

/** Inline size for small controls so they stay tappable on coarse pointers. */
const touch: CSSProperties = { minHeight: 'var(--control)' }

const card: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 10, rowGap: 2, alignItems: 'center', textAlign: 'left',
  minHeight: 56, padding: '8px 12px', borderRadius: 10, width: '100%', border: '1px solid var(--border)', background: '#26262d',
}

export function SkillEditorPanel({ controller }: { controller: GameController }) {
  const rules = controller.rules
  const isGm = controller.connection.isGm
  const custom = useGame((s) => s.customSkills)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  // Token the skill being created gets attached to on save (opened from the skill bar).
  const [attachTo, setAttachTo] = useState<TokenId | null>(null)
  const attachName = useGame((s) => (attachTo ? s.tokens[attachTo]?.name : undefined))
  // Requests from the skill bar; handled by `onRequest`, set further down once the helpers exist.
  const request = useSkillEditorRequests((s) => s.request)
  const onRequest = useRef<(r: SkillEditorRequest) => void>(() => {})
  useEffect(() => {
    if (!request) return
    const r = takeSkillEditorRequest()
    if (r) onRequest.current(r)
  }, [request])

  const pack = rules?.pack ?? null
  const packSkillIds = useMemo(() => new Set((pack?.skills ?? []).map((s) => s.id as string)), [pack])
  const customList = useMemo(() => Object.values(custom).sort((a, b) => a.name.localeCompare(b.name)), [custom])
  const takenIds = useMemo(() => new Set([...packSkillIds, ...Object.keys(custom)]), [packSkillIds, custom])

  const validation = useMemo(() => (view.kind === 'edit' ? validateForm(view.form, pack) : null), [view, pack])
  const dirty = view.kind === 'edit' && JSON.stringify(view.form) !== view.saved

  // Keep the JSON pane in step with the form while it is open and the form is valid.
  useEffect(() => {
    if (view.kind !== 'edit' || !showJson) return
    setJsonText(skillToJson(validation?.skill ?? skillFromForm(view.form)))
    setJsonError(null)
  }, [view, showJson, validation])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  if (!isGm) return null
  if (!rules || !pack) return <div className="panel"><h3>Skill editor</h3><p className="muted small">The rules pack did not load; skills cannot be edited.</p></div>

  const open = (form: SkillForm, editingId: string | null) => {
    setView({ kind: 'edit', form, saved: JSON.stringify(form), editingId })
    setTest(null)
    setConfirm(null)
    setShowJson(false)
  }
  const back = () => {
    setView({ kind: 'list' })
    setConfirm(null)
    setTest(null)
  }
  const newSkill = () => {
    const form = emptyForm()
    form.id = uniqueSlug('new-skill', takenIds)
    open(form, null)
  }
  const duplicate = (skill: SkillDef) => open(duplicateForm(skill, takenIds), null)
  const edit = (skill: SkillDef) => open(formFromSkill(skill), skill.id)
  /**
   * Override a pack skill: edit the existing override when there is one, otherwise start a new
   * skill pre-filled from the effective definition (`allSkills()` already applies overrides) with
   * the pack id kept, so saving replaces the pack skill instead of adding a copy next to it.
   */
  const override = (id: string) => {
    const existing = custom[id as SkillDef['id']]
    if (existing) { edit(existing); return }
    const source = rules.allSkills().find((s) => s.id === id) ?? pack.skills.find((s) => s.id === id)
    if (source) open(overrideForm(source), null)
  }
  onRequest.current = (r) => {
    if (r.kind === 'new') { newSkill(); setAttachTo(r.attachTo ?? null); return }
    setAttachTo(null)
    const own = custom[r.skillId as SkillDef['id']]
    if (own) edit(own)
    else override(r.skillId)
  }
  /** Pack skills offered by the "Override pack skill" picker, in pack order. */
  const packSkills = pack.skills

  const save = async () => {
    if (view.kind !== 'edit' || !validation?.skill) return
    const skill = validation.skill
    // Renaming the id of a custom skill removes the old entry.
    if (view.editingId && view.editingId !== skill.id) await controller.dispatch({ type: 'skill.remove', skill: view.editingId as SkillDef['id'] })
    await controller.dispatch({ type: 'skill.upsert', skill })
    setView({ kind: 'edit', form: view.form, saved: JSON.stringify(view.form), editingId: skill.id })
    const token = attachTo ? useGame.getState().tokens[attachTo] : undefined
    if (token) {
      const all = [...rules.allSkills().filter((s) => s.id !== skill.id), skill]
      await controller.dispatch({ type: 'token.update', token: token.id, patch: { skills: withSkill(token, all, skill.id) } })
      setAttachTo(null)
      setNotice(`Saved and added to ${token.name}'s skills`)
      return
    }
    setNotice(`Saved · find it in Skills${packSkillIds.has(skill.id) ? ` (replaces the pack's ${skill.name})` : ''}`)
  }
  const remove = async () => {
    if (view.kind !== 'edit' || !view.editingId) return
    await controller.dispatch({ type: 'skill.remove', skill: view.editingId as SkillDef['id'] })
    back()
  }
  const runTest = async () => {
    if (view.kind !== 'edit') return
    const skill = validation?.skill ?? null
    if (!skill) { setTest({ ok: false, lines: ['Fix the errors above first.'] }); return }
    const source = testDummy(rules.blankCharacter('test-source', 'Tester'))
    const target = testDummy(rules.blankCharacter('test-target', 'Dummy'))
    try {
      const r = await rules.resolveSkill(skill, source, [target], newSeed())
      const lines = r.messages.length ? r.messages : ['(no messages)']
      lines.push(`${r.vfx.length} VFX cue${r.vfx.length === 1 ? '' : 's'}, ${r.patches.length} sheet patch${r.patches.length === 1 ? '' : 'es'}.`)
      setTest({ ok: true, lines })
    } catch (e) {
      setTest({ ok: false, lines: [(e as Error).message] })
    }
  }
  const applyJson = () => {
    if (view.kind !== 'edit') return
    const r = skillFromJson(jsonText)
    if ('error' in r) { setJsonError(r.error); return }
    setJsonError(null)
    setView({ ...view, form: formFromSkill(r.skill) })
  }
  const importSkills = async () => {
    let raw: unknown
    try {
      raw = JSON.parse(importText)
    } catch (e) {
      setImportError(`invalid JSON: ${(e as Error).message}`)
      return
    }
    const list = Array.isArray(raw) ? raw : [raw]
    const skills: SkillDef[] = []
    for (const [i, item] of list.entries()) {
      const r = skillFromJson(JSON.stringify(item))
      if ('error' in r) { setImportError(`skill ${i + 1}: ${r.error}`); return }
      skills.push(r.skill)
    }
    for (const s of skills) await controller.dispatch({ type: 'skill.upsert', skill: s })
    setImportError(null)
    setImportText('')
    setNotice(`Imported ${skills.length} skill${skills.length === 1 ? '' : 's'}.`)
  }

  // ------------------------------------------------------------------ list

  if (view.kind === 'list') {
    const allJson = JSON.stringify(customList, null, 2)
    return (
      <div className="panel">
        <h3>
          Skill editor
          <button type="button" className="tiny primary" style={touch} onClick={newSkill}>+ Create</button>
        </h3>
        {notice && <p className="small ok" style={{ margin: '0 0 8px' }}>{notice}</p>}
        <p className="muted small" style={{ margin: '0 0 8px' }}>Custom skills ({customList.length}) · they appear in every sheet's Skills tab</p>
        {customList.length === 0 && <p className="muted small">None yet. Override or duplicate a pack skill below, or create a new one.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {customList.map((s) => (
            <button key={s.id} type="button" style={card} onClick={() => edit(s)}>
              <span style={{ fontWeight: 600, fontSize: 15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{glyph(s.icon)}{s.name}</span>
              <span className="small" style={{ color: 'var(--accent)' }}>{packSkillIds.has(s.id) ? 'overrides pack' : 'custom'}</span>
              <span className="muted small" style={{ gridColumn: '1 / -1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {describeTarget(s.target)} · {s.effects.length} effect{s.effects.length === 1 ? '' : 's'} · {s.vfx.length} vfx
              </span>
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: '16px 0 8px' }}>Pack skills: {pack.manifest.name}</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {pack.skills.map((s) => (
            <div key={s.id} style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ flex: '1 1 6em', minWidth: 0, fontWeight: 600, fontSize: 15, overflowWrap: 'anywhere' }}>{s.name}</span>
              <span className="row" style={{ marginTop: 0, flex: 'none' }}>
                <button type="button" className="tiny" style={touch} onClick={() => override(s.id)} title={custom[s.id] ? 'Edit the override of this pack skill' : 'Edit a replacement with the same id; every sheet gets it instead of the pack version'}>{custom[s.id] ? 'Edit override' : 'Override'}</button>
                <button type="button" className="tiny" style={touch} onClick={() => duplicate(s)} title="Copy under a new id, next to the pack skill">Duplicate</button>
              </span>
              <span className="muted small" style={{ flexBasis: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {describeTarget(s.target)} · {s.effects.length} effect{s.effects.length === 1 ? '' : 's'}{custom[s.id] ? ' · overridden above' : ''}
              </span>
            </div>
          ))}
        </div>
        <details style={{ marginTop: 16 }}>
          <summary className="disclosure">Import / export JSON</summary>
          <p className="muted small">Paste one skill or a list of skills to add them to this game.</p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5} placeholder='{ "id": "...", "name": "...", ... }' spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
          {importError && <p className="small error">{importError}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="primary" onClick={() => void importSkills()} disabled={!importText.trim()}>Import</button>
            <button type="button" onClick={() => void copyText(allJson).then((ok) => setNotice(ok ? 'Copied all custom skills.' : 'Copy failed; select the text below.'))} disabled={customList.length === 0}>Copy all custom</button>
          </div>
          {customList.length > 0 && <textarea readOnly value={allJson} rows={6} style={{ marginTop: 8, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />}
        </details>
      </div>
    )
  }

  // ------------------------------------------------------------------ edit

  const errorsCount = Object.keys(validation?.errors ?? {}).length + (validation?.general.length ?? 0)
  const canSave = validation?.skill !== null && !!validation?.skill
  const isCustom = view.editingId !== null
  const overridesPack = !isCustom && packSkillIds.has(view.form.id)
  // Create for a skill this game does not have yet; Save once it exists.
  const verb = isCustom ? 'Save' : 'Create'

  return (
    <div className="panel">
      <h3>
        Skill editor
        <button type="button" className="tiny" style={touch} onClick={() => (dirty ? setConfirm('discard') : back())}>‹ Back</button>
        <button type="button" className="tiny primary" style={touch} onClick={() => void save()} disabled={!canSave}>{verb}</button>
      </h3>
      {confirm === 'discard' && (
        <div className="row" style={{ marginTop: 0, marginBottom: 8, alignItems: 'center' }}>
          <span className="small">Discard unsaved changes?</span>
          <button type="button" className="danger" onClick={back}>Discard</button>
          <button type="button" onClick={() => setConfirm(null)}>Keep editing</button>
        </div>
      )}
      {notice && <p className="small ok" style={{ margin: '0 0 8px' }}>{notice}</p>}
      {attachName && !isCustom && <p className="small" style={{ margin: '0 0 8px', color: 'var(--accent)' }}>Saving adds it to {attachName}'s skills.</p>}
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        {isCustom ? `Editing custom skill ${view.editingId}` : overridesPack ? `New skill · overrides the pack's ${view.form.id}` : 'New skill'}{dirty ? ' · unsaved' : ''}
        {errorsCount > 0 && <span className="error"> · {errorsCount} problem{errorsCount === 1 ? '' : 's'}</span>}
      </p>
      {!isCustom && (
        <label className="small" style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          <span className="muted">Override pack skill</span>
          <select value={overridesPack ? view.form.id : ''} onChange={(e) => { if (e.target.value) override(e.target.value) }} style={touch}>
            <option value="">Start from scratch</option>
            {packSkills.map((s) => <option key={s.id} value={s.id}>{s.name}{custom[s.id] ? ' (already overridden)' : ''}</option>)}
          </select>
          <span className="muted">Pre-fills the form from the pack skill and keeps its id, so saving replaces it in every sheet.</span>
        </label>
      )}

      <SkillFormView
        form={view.form}
        errors={validation?.errors ?? {}}
        pack={pack}
        packSkillIds={packSkillIds}
        customSkillIds={new Set(Object.keys(custom).filter((id) => id !== view.editingId))}
        onChange={(form) => setView({ ...view, form })}
      />

      {validation && validation.general.length > 0 && (
        <div className="small error" style={{ marginTop: 8 }}>{validation.general.map((g, i) => <div key={i}>{g}</div>)}</div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="primary" onClick={() => void save()} disabled={!canSave}>{verb}</button>
        <button type="button" onClick={() => void runTest()}>Test</button>
        <button type="button" onClick={() => setShowJson((v) => !v)} aria-pressed={showJson}>JSON</button>
        {isCustom && confirm !== 'delete' && <button type="button" className="danger" onClick={() => setConfirm('delete')}>Delete</button>}
      </div>
      {confirm === 'delete' && (
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="small">Delete this custom skill{packSkillIds.has(view.editingId ?? '') ? ' and restore the pack version' : ''}?</span>
          <button type="button" className="danger" onClick={() => void remove()}>Delete</button>
          <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}

      {test && (
        <div className="small" style={{ marginTop: 8, padding: '6px 8px', borderRadius: 8, background: '#101014', borderLeft: `3px solid ${test.ok ? 'var(--accent)' : 'var(--danger)'}` }}>
          <div className="muted" style={{ marginBottom: 4 }}>Test run: Tester casts at Dummy (both with every stat at 10). The document is not changed.</div>
          {test.lines.map((l, i) => <div key={i} style={{ color: test.ok ? undefined : 'var(--danger)' }}>{l}</div>)}
        </div>
      )}

      {showJson && (
        <div style={{ marginTop: 8 }}>
          <p className="muted small">Edit or paste JSON and apply it to the form; copy it to share or drop into a pack's <code>skills/</code> folder.</p>
          <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={12} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
          {jsonError && <p className="small error">{jsonError}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={applyJson}>Apply to form</button>
            <button type="button" onClick={() => void copyText(jsonText).then((ok) => setNotice(ok ? 'Copied.' : 'Copy failed; select the text instead.'))}>Copy</button>
          </div>
        </div>
      )}
    </div>
  )
}
