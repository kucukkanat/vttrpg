/**
 * Small touch-first controls shared by the skill editor form: labelled fields with inline errors,
 * a number stepper with 44px buttons, a resource picker over the pack's resources and attributes,
 * and the row chrome (move up/down, delete) used by effect and VFX rows.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { LoadedPack } from '@/rules'

export const CUSTOM_RESOURCE = '__custom__'

export function Field({ label, error, hint, children, style }: { label: string; error?: string; hint?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <label style={{ margin: 0, ...style }}>
      <span className="small muted">{label}</span>
      {children}
      {error ? <span className="small error" role="alert">{error}</span> : hint ? <span className="small muted">{hint}</span> : null}
    </label>
  )
}

export function TextField({ label, value, onChange, error, hint, placeholder, multiline, mono, inputMode }: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: string
  placeholder?: string
  multiline?: boolean
  mono?: boolean
  inputMode?: 'text' | 'numeric' | 'decimal'
}) {
  const style: CSSProperties = {
    fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
    borderColor: error ? 'var(--danger)' : undefined,
  }
  return (
    <Field label={label} error={error} hint={hint}>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} style={style} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={style} inputMode={inputMode} autoCapitalize={mono ? 'off' : undefined} autoCorrect={mono ? 'off' : undefined} spellCheck={mono ? false : undefined} />
      )}
    </Field>
  )
}

/** Number input flanked by - and + buttons. The value stays a string so partial typing is kept. */
export function Stepper({ label, value, onChange, step = 1, min, error, unit }: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: number
  min?: number
  error?: string
  unit?: string
}) {
  const bump = (dir: 1 | -1) => {
    const n = Number(value.trim() === '' ? 0 : value)
    const base = Number.isFinite(n) ? n : 0
    let next = Math.round((base + dir * step) * 1000) / 1000
    if (min !== undefined && next < min) next = min
    onChange(String(next))
  }
  return (
    <Field label={unit ? `${label} (${unit})` : label} error={error}>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--control) 1fr var(--control)', gap: 4 }}>
        <button type="button" onClick={() => bump(-1)} aria-label={`${label} minus ${step}`} style={{ padding: 0 }}>−</button>
        <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} style={{ textAlign: 'center', borderColor: error ? 'var(--danger)' : undefined }} />
        <button type="button" onClick={() => bump(1)} aria-label={`${label} plus ${step}`} style={{ padding: 0 }}>+</button>
      </div>
    </Field>
  )
}

export function Select<T extends string>({ label, value, options, onChange, error, labelOf }: {
  label: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  error?: string
  labelOf?: (v: T) => string
}) {
  return (
    <Field label={label} error={error}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} style={{ borderColor: error ? 'var(--danger)' : undefined }}>
        {options.map((o) => <option key={o} value={o}>{labelOf ? labelOf(o) : o}</option>)}
      </select>
    </Field>
  )
}

/** Resources and attributes of the pack, or a free dotted path into the sheet. */
export function ResourcePicker({ label, value, onChange, pack, error }: {
  label: string
  value: string
  onChange: (v: string) => void
  pack: Pick<LoadedPack, 'resources' | 'attributes'> | null
  error?: string
}) {
  const options: { id: string; name: string }[] = [
    ...(pack?.resources ?? []).map((r) => ({ id: r.id, name: r.name })),
    ...(pack?.attributes ?? []).filter((a) => a.derived === undefined).map((a) => ({ id: a.id, name: `${a.name} (attribute)` })),
  ]
  const known = options.some((o) => o.id === value)
  const custom = value !== '' && !known
  return (
    <Field label={label} error={error}>
      <div style={{ display: 'grid', gridTemplateColumns: custom ? '1fr 1fr' : '1fr', gap: 4 }}>
        <select
          value={custom ? CUSTOM_RESOURCE : value}
          onChange={(e) => onChange(e.target.value === CUSTOM_RESOURCE ? 'hp.current' : e.target.value)}
          style={{ borderColor: error ? 'var(--danger)' : undefined }}
        >
          <option value="">Pick…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value={CUSTOM_RESOURCE}>Other path…</option>
        </select>
        {custom && <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="path.in.sheet" autoCapitalize="off" spellCheck={false} />}
      </div>
    </Field>
  )
}

/** Toggle chips, 44px tall, for picking several ids. */
export function Chips({ options, value, onChange, labelOf }: {
  options: readonly string[]
  value: string[]
  onChange: (v: string[]) => void
  labelOf?: (id: string) => string
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.length === 0 && <span className="muted small">none in this pack</span>}
      {options.map((id) => {
        const on = value.includes(id)
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(id)}
            style={{ borderColor: on ? 'var(--select)' : undefined, background: on ? 'var(--row-on)' : undefined, borderRadius: 999 }}
          >
            {labelOf ? labelOf(id) : id}
          </button>
        )
      })}
    </div>
  )
}

/** A card with a title row and move/delete controls; the body is the row's fields. */
export function RowCard({ title, index, count, onMove, onDelete, children }: {
  title: ReactNode
  index: number
  count: number
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  children: ReactNode
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 'var(--sp-2)', background: 'var(--panel-2)', display: 'grid', gap: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</span>
        <button type="button" className="icon" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">↑</button>
        <button type="button" className="icon" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">↓</button>
        <button type="button" className="icon danger" onClick={onDelete} aria-label="Delete row">✕</button>
      </div>
      {children}
    </div>
  )
}

export const twoCol: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 'var(--sp-2)', alignItems: 'start' }
