/**
 * Numeric editors for whatever is being edited on the table (token, prop, scene node or the whole
 * scene), shown under "Details" in the edit bar (shell/EditBar.tsx), and adding props from the
 * library or an uploaded GLB (Prep panel and the edit bar). Every change goes through `controller.dispatch`;
 * players only get controls for tokens they own and a read-only summary otherwise.
 * Built for thumbs: big +/- steppers, direct input, no hover-only affordances.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { GameController } from '../controller'
import { useGame, type Selection } from '@/state/store'
import { newId } from '@/core/ids'
import type { PropId, SceneId } from '@/core/ids'
import type { NodeOverride, Prop, Scene, SceneTransform, Token } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { LibraryEntry } from '@/assets'
import {
  clamp, degToRad, displayDeg, effectiveNodeTransform, IDENTITY_TRANSFORM, mergeOverride, placementPoint, resetOverride, roundTo,
  SCALE_LIMITS, TOKEN_SIZE_LIMITS, useTableUi,
} from '@/table'
import { CATEGORY_LABEL, libraryModels, libraryRef, loadLibraryIndex, type LibraryCategory } from '../library'

const TOUCH = 44

const stepperStyle: CSSProperties = { display: 'grid', gridTemplateColumns: `${TOUCH}px 1fr ${TOUCH}px`, gap: 4, alignItems: 'stretch' }
const bigBtn: CSSProperties = { minHeight: TOUCH, minWidth: TOUCH, padding: 0, fontSize: 20, lineHeight: 1, touchAction: 'manipulation' }
const fieldStyle: CSSProperties = { minHeight: TOUCH, textAlign: 'center', fontSize: 15, padding: '6px 4px' }
/** Two steppers side by side when the column is wide enough, stacked otherwise (a stepper needs ~150 px). */
const pairStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 8px' }
const labelRow: CSSProperties ={ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, color: 'var(--muted)' }
const sectionTitle: CSSProperties = { margin: '10px 0 4px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }

/**
 * Number with big +/- buttons and a typed field. Typing is kept in a local draft until Enter or
 * blur so "1." does not get committed as 1 halfway through.
 */
function Stepper({ label, value, step, min, max, unit, decimals = 2, onChange, disabled, wrap }: {
  label: string; value: number; step: number; min?: number; max?: number; unit?: string; decimals?: number
  onChange(v: number): void; disabled?: boolean
  /** Degrees: values outside (-180, 180] wrap instead of clamping. */
  wrap?: boolean
}) {
  const shown = roundTo(value, Math.pow(10, -decimals))
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const apply = (raw: number) => {
    if (!Number.isFinite(raw)) return
    let v = roundTo(raw, Math.pow(10, -decimals))
    if (wrap) v = ((v + 180) % 360 + 360) % 360 - 180
    if (min !== undefined || max !== undefined) v = clamp(v, min ?? -Infinity, max ?? Infinity)
    if (v !== shown) onChange(v)
  }
  const commitDraft = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    setDraft(null)
    apply(n)
  }
  return (
    <div>
      <div style={labelRow}><span>{label}</span>{unit && <span className="small">{unit}</span>}</div>
      <div style={stepperStyle}>
        <button type="button" style={bigBtn} aria-label={`${label} minus`} disabled={disabled || (min !== undefined && !wrap && shown <= min)} onClick={() => apply(shown - step)}>−</button>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          style={fieldStyle}
          value={draft ?? String(shown)}
          disabled={disabled}
          aria-label={label}
          onFocus={(e) => { setDraft(String(shown)); e.target.select() }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitDraft(); ref.current?.blur() } if (e.key === 'Escape') { setDraft(null); ref.current?.blur() } }}
        />
        <button type="button" style={bigBtn} aria-label={`${label} plus`} disabled={disabled || (max !== undefined && !wrap && shown >= max)} onClick={() => apply(shown + step)}>+</button>
      </div>
    </div>
  )
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <label className="check" style={{ minHeight: 36, margin: 0 }}>
      <input type="checkbox" style={{ width: 22, height: 22 }} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', margin: '6px 0', fontSize: 13 }}>
      {rows.map(([k, v]) => [<dt key={`${k}-k`} className="muted">{k}</dt>, <dd key={`${k}-v`} style={{ margin: 0 }}>{v}</dd>])}
    </dl>
  )
}

const fmt = (v: number) => roundTo(v, 0.01)
const vec = (v: Vec3) => `${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}`

function Header({ kind, name, onDeselect }: { kind: string; name: string; onDeselect(): void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{kind}</span>
      <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
      <button type="button" className="tiny" style={{ minHeight: 32, touchAction: 'manipulation' }} onClick={onDeselect}>Done</button>
    </div>
  )
}

export function Selected({ controller, selection, scene, sceneId, onDeselect }: { controller: GameController; selection: Selection; scene: Scene; sceneId: SceneId; onDeselect(): void }) {
  const isGm = controller.connection.isGm
  const token = useGame((s) => (selection.kind === 'token' ? s.tokens[selection.id] : undefined))
  const prop = useGame((s) => (selection.kind === 'prop' ? s.props[selection.id] : undefined))
  const nodeBase = useTableUi((s) => s.nodeBase)
  const cell = scene.grid.cellSize

  switch (selection.kind) {
    case 'token':
      if (!token) return <p className="muted small">That token is gone.</p>
      return <TokenEditor controller={controller} token={token} editable={isGm || token.owner === controller.pubkey} onDeselect={onDeselect} />
    case 'prop':
      if (!prop) return <p className="muted small">That prop is gone.</p>
      return <PropEditor controller={controller} prop={prop} cell={cell} editable={isGm} onDeselect={onDeselect} />
    case 'node': {
      const override = scene.overrides?.[selection.id]
      return <NodeEditor controller={controller} sceneId={sceneId} scene={scene} name={selection.id} override={override} base={nodeBase?.name === selection.id ? nodeBase : null} cell={cell} editable={isGm} onDeselect={onDeselect} />
    }
    case 'scene':
      return <SceneEditor controller={controller} sceneId={sceneId} scene={scene} cell={cell} editable={isGm} onDeselect={onDeselect} />
  }
}

function TokenEditor({ controller, token, editable, onDeselect }: { controller: GameController; token: Token; editable: boolean; onDeselect(): void }) {
  const patch = (p: Partial<Token>) => void controller.dispatch({ type: 'token.update', token: token.id, patch: p })
  const elevation = token.elevation ?? 0
  if (!editable) {
    return (
      <div className="props">
        <Header kind="Token" name={token.name} onDeselect={onDeselect} />
        <Summary rows={[['Size', `×${fmt(token.scale)}`], ['Rotation', `${displayDeg(token.rotationY)}°`], ['Elevation', `${fmt(elevation)} m`]]} />
        <p className="muted small">{token.owner ? 'Only its owner or the GM can edit this token.' : 'Claim it from the Tokens panel to edit it.'}</p>
      </div>
    )
  }
  return (
    <div className="props">
      <Header kind="Token" name={token.name} onDeselect={onDeselect} />
      <Stepper label="Size" value={token.scale} step={0.25} min={TOKEN_SIZE_LIMITS.min} max={TOKEN_SIZE_LIMITS.max} unit="× cell" onChange={(v) => patch({ scale: v })} />
      <Stepper label="Rotation" value={displayDeg(token.rotationY)} step={15} unit="degrees" decimals={1} wrap onChange={(v) => patch({ rotationY: degToRad(v) })} />
      <Stepper label="Elevation" value={elevation} step={0.25} min={0} max={50} unit="m above floor" onChange={(v) => patch({ elevation: v })} />
      <ModelPicker
        controller={controller}
        title="Token model"
        actionLabel="Use"
        kinds={TOKEN_KINDS}
        current={token.model ? (token.model.name?.replace(/\.glb$/i, '') ?? 'custom model') : 'disc with initials'}
        hint="Models are fitted to one cell; Size scales from there."
        onPick={(model) => patch({ model })}
        onClear={token.model ? () => patch({ model: undefined }) : undefined}
      />
    </div>
  )
}

/** What each picker offers; whole scenes never show up here (the Scenes panel owns those). */
const TOKEN_KINDS: LibraryCategory[] = ['mini', 'prop']
const PROP_KINDS: LibraryCategory[] = ['prop', 'mini']

function PropEditor({ controller, prop, cell, editable, onDeselect }: { controller: GameController; prop: Prop; cell: number; editable: boolean; onDeselect(): void }) {
  const patch = (p: Partial<Prop>) => void controller.dispatch({ type: 'prop.update', prop: prop.id, patch: p })
  const setSelection = useGame((s) => s.setSelection)
  const [name, setName] = useState(prop.name)
  useEffect(() => setName(prop.name), [prop.name])
  if (!editable) {
    return (
      <div className="props">
        <Header kind="Prop" name={prop.name} onDeselect={onDeselect} />
        <Summary rows={[['Position', vec(prop.position)], ['Rotation', `${displayDeg(prop.rotation.y)}°`], ['Scale', `×${fmt(prop.scale)}`], ['Solid', prop.solid ? 'blocks sight' : 'no']]} />
      </div>
    )
  }
  const pos = (k: keyof Vec3) => (v: number) => patch({ position: { ...prop.position, [k]: v } })
  const rot = (k: keyof Vec3) => (v: number) => patch({ rotation: { ...prop.rotation, [k]: degToRad(v) } })
  return (
    <div className="props">
      <Header kind="Prop" name={prop.name} onDeselect={onDeselect} />
      <label>Name
        <input value={name} style={{ minHeight: 40 }} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== prop.name) patch({ name: name.trim() }) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      </label>
      <div style={sectionTitle}>Position</div>
      <div style={pairStyle}>
        <Stepper label="X" value={prop.position.x} step={cell / 2} unit="m" onChange={pos('x')} />
        <Stepper label="Z" value={prop.position.z} step={cell / 2} unit="m" onChange={pos('z')} />
      </div>
      <Stepper label="Height (Y)" value={prop.position.y} step={0.1} unit="m" onChange={pos('y')} />
      <div style={sectionTitle}>Rotation</div>
      <Stepper label="Turn (Y)" value={displayDeg(prop.rotation.y)} step={15} unit="degrees" decimals={1} wrap onChange={rot('y')} />
      <div style={pairStyle}>
        <Stepper label="Tilt X" value={displayDeg(prop.rotation.x)} step={15} decimals={1} wrap onChange={rot('x')} />
        <Stepper label="Tilt Z" value={displayDeg(prop.rotation.z)} step={15} decimals={1} wrap onChange={rot('z')} />
      </div>
      <div style={sectionTitle}>Size</div>
      <Stepper label="Scale" value={prop.scale} step={0.05} min={SCALE_LIMITS.min} max={SCALE_LIMITS.max} unit="×" onChange={(v) => patch({ scale: v })} />
      <div className="row" style={{ marginTop: 4 }}>
        <Check label="Locked (no table drag)" checked={!!prop.locked} onChange={(v) => patch({ locked: v })} />
        <Check label="Solid (blocks sight)" checked={!!prop.solid} onChange={(v) => patch({ solid: v })} />
      </div>
      <button type="button" className="danger wide" style={{ minHeight: TOUCH }} onClick={() => { void controller.dispatch({ type: 'prop.remove', prop: prop.id }); setSelection(null) }}>
        Remove prop
      </button>
      <p className="muted small">Delete key removes the selected prop. Drag it on the table to move it; Alt while dragging skips snapping.</p>
    </div>
  )
}

function NodeEditor({ controller, sceneId, scene, name, override, base, cell, editable, onDeselect }: {
  controller: GameController; sceneId: SceneId; scene: Scene; name: string; override: NodeOverride | undefined
  base: { position: Vec3; rotation: Vec3; scale: Vec3 } | null; cell: number; editable: boolean; onDeselect(): void
}) {
  const fallback = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true }
  const t = effectiveNodeTransform(base ? { ...base, visible: true } : fallback, override)
  const edit = (p: Partial<NodeOverride>) => void controller.dispatch({ type: 'scene.update', scene: sceneId, patch: { overrides: mergeOverride(scene.overrides, name, p) } })
  const reset = () => void controller.dispatch({ type: 'scene.update', scene: sceneId, patch: { overrides: resetOverride(scene.overrides, name) } })
  const changed = !!override && Object.keys(override).length > 0
  if (!editable) {
    return (
      <div className="props">
        <Header kind="Scene part" name={name} onDeselect={onDeselect} />
        <Summary rows={[['Position', vec(t.position)], ['Rotation', `${displayDeg(t.rotationY)}°`], ['Scale', `×${fmt(t.scale)}`], ['Hidden', t.hidden ? 'yes' : 'no']]} />
      </div>
    )
  }
  const pos = (k: keyof Vec3) => (v: number) => edit({ position: { ...t.position, [k]: v } })
  return (
    <div className="props">
      <Header kind="Scene part" name={name} onDeselect={onDeselect} />
      {!base && <p className="muted small">The model is still loading; values start from zero until it is ready.</p>}
      <div style={sectionTitle}>Position (in the room)</div>
      <div style={pairStyle}>
        <Stepper label="X" value={t.position.x} step={cell / 2} unit="m" onChange={pos('x')} />
        <Stepper label="Z" value={t.position.z} step={cell / 2} unit="m" onChange={pos('z')} />
      </div>
      <Stepper label="Height (Y)" value={t.position.y} step={0.1} unit="m" onChange={pos('y')} />
      <Stepper label="Turn (Y)" value={displayDeg(t.rotationY)} step={15} unit="degrees" decimals={1} wrap onChange={(v) => edit({ rotationY: degToRad(v) })} />
      <Stepper label="Scale" value={t.scale} step={0.05} min={SCALE_LIMITS.min} max={SCALE_LIMITS.max} unit="× authored size" onChange={(v) => edit({ scale: v })} />
      <Check label="Hidden" checked={t.hidden} onChange={(v) => edit({ hidden: v })} />
      <button type="button" className="wide" style={{ minHeight: TOUCH }} disabled={!changed} onClick={reset}>Reset to the model</button>
    </div>
  )
}

function SceneEditor({ controller, sceneId, scene, cell, editable, onDeselect }: { controller: GameController; sceneId: SceneId; scene: Scene; cell: number; editable: boolean; onDeselect(): void }) {
  const t: SceneTransform = scene.transform ?? IDENTITY_TRANSFORM
  const set = (next: SceneTransform) => void controller.dispatch({ type: 'scene.update', scene: sceneId, patch: { transform: next } })
  const changed = t.scale !== 1 || t.rotationY !== 0 || t.offset.x !== 0 || t.offset.y !== 0 || t.offset.z !== 0
  if (!editable) {
    return (
      <div className="props">
        <Header kind="Scene" name={scene.name} onDeselect={onDeselect} />
        <Summary rows={[['Scale', `×${fmt(t.scale)}`], ['Rotation', `${displayDeg(t.rotationY)}°`], ['Offset', vec(t.offset)]]} />
      </div>
    )
  }
  const off = (k: keyof Vec3) => (v: number) => set({ ...t, offset: { ...t.offset, [k]: v } })
  return (
    <div className="props">
      <Header kind="Scene" name={scene.name} onDeselect={onDeselect} />
      <Stepper label="Scale" value={t.scale} step={0.05} min={SCALE_LIMITS.min} max={SCALE_LIMITS.max} unit="×" onChange={(v) => set({ ...t, scale: v })} />
      <Stepper label="Turn (Y)" value={displayDeg(t.rotationY)} step={15} unit="degrees" decimals={1} wrap onChange={(v) => set({ ...t, rotationY: degToRad(v) })} />
      <div style={sectionTitle}>Offset</div>
      <div style={pairStyle}>
        <Stepper label="X" value={t.offset.x} step={cell / 2} unit="m" onChange={off('x')} />
        <Stepper label="Z" value={t.offset.z} step={cell / 2} unit="m" onChange={off('z')} />
      </div>
      <Stepper label="Height (Y)" value={t.offset.y} step={0.1} unit="m" onChange={off('y')} />
      <button type="button" className="wide" style={{ minHeight: TOUCH }} disabled={!changed} onClick={() => set({ ...IDENTITY_TRANSFORM, offset: { x: 0, y: 0, z: 0 } })}>Reset scene transform</button>
      <p className="muted small">The grid is not moved with the scene; adjust it in the Scenes panel if cells drift.</p>
    </div>
  )
}

/**
 * Library dropdown (only the given model categories, grouped in that order) plus an upload.
 * Calls `onPick` with the chosen model; never adds anything itself.
 */
export function ModelPicker({ controller, title, actionLabel, kinds, hint, current, onPick, onClear }: {
  controller: GameController
  title: string
  actionLabel: string
  kinds: readonly LibraryCategory[]
  hint?: string
  current?: string
  onPick(model: ReturnType<typeof libraryRef>, name: string): void
  onClear?(): void
}) {
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { void loadLibraryIndex().then((l) => setLibrary(l.filter((e) => e.kind === 'glb'))) }, [])
  const groups = kinds.map((k) => ({ kind: k, entries: libraryModels(library, k) })).filter((g) => g.entries.length > 0)
  const pickFromLibrary = () => {
    const entry = library.find((e) => e.sha256 === choice)
    if (entry) onPick(libraryRef(entry), entry.name.replace(/\.glb$/i, ''))
  }
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(file.name)
    try {
      const ref = await controller.assets.shareFile(file)
      onPick(ref, file.name.replace(/\.glb$/i, ''))
    } catch (e) {
      console.warn('model upload failed', e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="props">
      <div style={sectionTitle}>{title}</div>
      {current !== undefined && (
        <div className="row" style={{ alignItems: 'center', marginTop: 0 }}>
          <span className="muted small" style={{ flex: 1 }}>Current: {current}</span>
          {onClear && <button type="button" style={{ minHeight: 40 }} onClick={onClear}>Use disc</button>}
        </div>
      )}
      {groups.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
          <select value={choice} style={{ minHeight: 40 }} onChange={(e) => setChoice(e.target.value)} aria-label={`${title} library`}>
            <option value="">Pick a model…</option>
            {groups.map((g) => (
              <optgroup key={g.kind} label={CATEGORY_LABEL[g.kind]}>
                {g.entries.map((l) => <option key={l.sha256} value={l.sha256}>{l.name.replace(/\.glb$/i, '').replace(/-/g, ' ')}</option>)}
              </optgroup>
            ))}
          </select>
          <button type="button" style={{ minHeight: 40, touchAction: 'manipulation' }} disabled={!choice} onClick={pickFromLibrary}>{actionLabel}</button>
        </div>
      )}
      <label className="tiny-file" style={{ minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {busy ? `Importing ${busy}…` : 'Upload a .glb'}
        <input type="file" accept=".glb,model/gltf-binary" hidden disabled={!!busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {hint && <p className="muted small">{hint}</p>}
    </div>
  )
}

export function AddProp({ controller, sceneId, scene }: { controller: GameController; sceneId: SceneId; scene: Scene | undefined }) {
  const setSelection = useGame((s) => s.setSelection)
  const uiSet = useTableUi((s) => s.set)
  const add = (model: ReturnType<typeof libraryRef>, name: string) => {
    const id = newId<'PropId'>() as PropId
    const at = placementPoint()
    const g = scene?.grid
    const position = g && g.type !== 'none'
      ? { x: Math.round((at.x - g.origin.x) / g.cellSize) * g.cellSize + g.origin.x, y: at.y, z: Math.round((at.z - g.origin.z) / g.cellSize) * g.cellSize + g.origin.z }
      : at
    void controller.dispatch({ type: 'prop.add', prop: { id, scene: sceneId, name, model, position, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } })
    setSelection({ kind: 'prop', id })
    uiSet({ editMode: true })
  }
  return (
    <ModelPicker
      controller={controller}
      title="Add a prop"
      actionLabel="Add"
      kinds={PROP_KINDS}
      hint="Props are scenery, not tokens. They land where the camera looks; double-tap one on the table to move, turn and resize it."
      onPick={add}
    />
  )
}
