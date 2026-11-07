/**
 * Numeric inspector for the prop selection (advanced mode, in the edit bar's Details): position,
 * rotation in degrees and scale, per axis. Fields show the primary prop (the last selected) and
 * accept expressions (`1.5*2`, `(3+1)/2`) or relative forms (`+0.5`, `*2`, `/2`); see
 * table/build/expr.ts. A change applies to every selected prop as the same difference (position,
 * rotation) or factor (scale), in one `props.update`, so one undo step.
 */
import { useState, type CSSProperties } from 'react'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { PropUpdate } from '@/core/intents'
import { PROP_SCALE_LIMITS, propScale } from '@/core/props'
import { useGame } from '@/state/store'
import { applyFieldExpr } from '@/table/build/expr'
import { degToRad, normalizeDeg, radToDeg } from '@/table/editing'
import { knownLegacyFit } from '@/table/propMigration'
import type { GameController } from '../controller'

type Field = 'position' | 'rotation' | 'scale'
const AXES = ['x', 'y', 'z'] as const

const fmt = (n: number) => {
  const v = Math.round(n * 1000) / 1000
  return String(v === 0 ? 0 : v)
}

/** The updates that change `field.axis` of every prop so the primary's value becomes `value`. */
export function inspectorUpdates(props: readonly Prop[], primary: Prop, field: Field, axis: keyof Vec3, value: number, fit: (p: Prop) => number = () => 1): PropUpdate[] {
  const out: PropUpdate[] = []
  if (field === 'position') {
    const d = value - primary.position[axis]
    if (Math.abs(d) < 1e-9) return out
    for (const p of props) out.push({ id: p.id, patch: { position: { ...p.position, [axis]: Number((p.position[axis] + d).toFixed(6)) } } })
  } else if (field === 'rotation') {
    const d = degToRad(value) - primary.rotation[axis]
    if (Math.abs(d) < 1e-9) return out
    for (const p of props) {
      const r = degToRad(normalizeDeg(radToDeg(p.rotation[axis] + d)))
      out.push({ id: p.id, patch: { rotation: { ...p.rotation, [axis]: Number(r.toFixed(9)) } } })
    }
  } else {
    const cur = propScale(primary, fit(primary))[axis]
    if (!(value > 0) || !(cur > 0)) return out
    const f = value / cur
    if (Math.abs(f - 1) < 1e-9) return out
    for (const p of props) {
      const s = propScale(p, fit(p))
      const next = Math.min(PROP_SCALE_LIMITS.max, Math.max(PROP_SCALE_LIMITS.min, s[axis] * f))
      out.push({ id: p.id, patch: { scale: { ...s, [axis]: Number(next.toFixed(6)) } } })
    }
  }
  return out
}

const title: CSSProperties = { margin: '8px 0 4px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', opacity: 0.8 }

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit(text: string): boolean }) {
  // What is being typed; null shows the current value (which follows the document).
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const commit = () => {
    if (draft === null || draft.trim() === fmt(value)) { setDraft(null); setBad(false); return }
    const ok = onCommit(draft)
    setBad(!ok)
    if (ok) setDraft(null)
  }
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '1 1 0' }}>
      <span style={{ width: 12, fontSize: 12, opacity: 0.8 }}>{label}</span>
      <input
        value={draft ?? fmt(value)} inputMode="decimal" spellCheck={false} aria-invalid={bad} aria-label={label}
        style={{ minHeight: 36, width: '100%', minWidth: 0, borderColor: bad ? 'var(--error, #e66)' : undefined }}
        onFocus={(e) => e.target.select()}
        onChange={(e) => { setDraft(e.target.value); setBad(false) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); const el = e.target as HTMLInputElement; requestAnimationFrame(() => el.select()) }
          else if (e.key === 'Escape') { setDraft(null); setBad(false); (e.target as HTMLInputElement).blur() }
        }}
      />
    </label>
  )
}

export function PropInspector({ controller }: { controller: GameController }) {
  const ids = useGame((s) => s.propSelection)
  const all = useGame((s) => s.props)
  const props = ids.map((id) => all[id]).filter((p): p is Prop => !!p)
  const primary = props[props.length - 1]
  if (!primary) return null
  const fit = (p: Prop) => knownLegacyFit(p.id) ?? 1
  const scale = propScale(primary, fit(primary))
  const shown: Record<Field, Vec3> = {
    position: primary.position,
    rotation: { x: normalizeDeg(radToDeg(primary.rotation.x)), y: normalizeDeg(radToDeg(primary.rotation.y)), z: normalizeDeg(radToDeg(primary.rotation.z)) },
    scale,
  }
  const commit = (field: Field, axis: keyof Vec3) => (text: string): boolean => {
    const value = applyFieldExpr(text, shown[field][axis])
    if (value === null || (field === 'scale' && value <= 0)) return false
    const updates = inspectorUpdates(props, primary, field, axis, value, fit)
    if (updates.length) void controller.dispatch({ type: 'props.update', updates })
    return true
  }
  const rows: [Field, string][] = [['position', 'Position (m)'], ['rotation', 'Rotation (°)'], ['scale', 'Scale (×)']]
  return (
    <div className="prop-inspector" role="group" aria-label="Transform">
      {props.length > 1 && <p className="small" style={{ margin: '0 0 4px', opacity: 0.8 }}>{props.length} props: changes apply to all, as shown on {primary.name}.</p>}
      {rows.map(([field, label]) => (
        <div key={field} style={{ marginBottom: 6 }}>
          <div style={title}>{label}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {AXES.map((axis) => (
              <NumberField key={axis} label={axis.toUpperCase()} value={shown[field][axis]} onCommit={commit(field, axis)} />
            ))}
          </div>
        </div>
      ))}
      <p className="small" style={{ margin: '0 0 8px', opacity: 0.8 }}>Type a value or an expression: 1.5*2, +0.5, *2.</p>
    </div>
  )
}
