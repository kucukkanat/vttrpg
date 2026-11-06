/**
 * Generic character sheet renderer driven by a pack's `SheetSchema`.
 * Binds are dotted paths into `character.data`; the special bind `name` is the
 * character's name. Edits are reported through `onChange(path, value)` with the
 * same path convention; roll buttons call `onRoll(formula, label)`.
 */
import type { Character } from '@/core/doc'
import type { SheetField, SheetSchema, SheetSection } from '@/core/pack'
import { getPath } from './expr'
import { isContinuation, isItem, type InventorySlot } from './scope'
import './SheetView.css'

export interface SheetViewProps {
  schema: SheetSchema
  character: Character
  onChange(path: string, value: unknown): void
  onRoll(formula: string, label: string): void
  readOnly?: boolean
}

function read(character: Character, bind: string): unknown {
  if (bind === 'name') return character.name
  return getPath(character.data, bind.split('.'))
}

export function SheetView({ schema, character, onChange, onRoll, readOnly = false }: SheetViewProps) {
  return (
    <div className="sheet">
      {schema.sections.map((section, i) => (
        <Section key={`${section.title}-${i}`} section={section} character={character} onChange={onChange} onRoll={onRoll} readOnly={readOnly} />
      ))}
    </div>
  )
}

interface FieldProps {
  character: Character
  onChange(path: string, value: unknown): void
  onRoll(formula: string, label: string): void
  readOnly: boolean
}

function Section({ section, ...rest }: { section: SheetSection } & FieldProps) {
  const cols = section.columns ?? 1
  return (
    <section>
      <h3>{section.title}</h3>
      <div className="fields" style={{ ['--cols' as string]: cols }}>
        {section.fields.map((field, i) => (
          <Field key={i} field={field} {...rest} />
        ))}
      </div>
    </section>
  )
}

function Field({ field, character, onChange, onRoll, readOnly }: { field: SheetField } & FieldProps) {
  switch (field.kind) {
    case 'number': {
      const v = read(character, field.bind)
      const n = typeof v === 'number' ? v : ''
      return (
        <label className="field">
          <span>{field.label}</span>
          {field.readonly || readOnly ? (
            <div className="readonly">{n}</div>
          ) : (
            <input type="number" value={n} onChange={(e) => onChange(field.bind, e.target.value === '' ? 0 : Number(e.target.value))} />
          )}
        </label>
      )
    }
    case 'text': {
      const v = read(character, field.bind)
      const s = typeof v === 'string' || typeof v === 'number' ? String(v) : ''
      return (
        <label className={`field${field.multiline ? ' span-all' : ''}`}>
          <span>{field.label}</span>
          {field.multiline ? (
            <textarea rows={4} value={s} readOnly={readOnly} onChange={(e) => onChange(field.bind, e.target.value)} />
          ) : (
            <input type="text" value={s} readOnly={readOnly} onChange={(e) => onChange(field.bind, e.target.value)} />
          )}
        </label>
      )
    }
    case 'resource': {
      const v = read(character, field.bind)
      const cur = typeof getPath(v, ['current']) === 'number' ? (getPath(v, ['current']) as number) : ''
      const max = typeof getPath(v, ['max']) === 'number' ? (getPath(v, ['max']) as number) : ''
      const num = (s: string) => (s === '' ? 0 : Number(s))
      return (
        <div className="field">
          <span>{field.label}</span>
          <div className="resource">
            <input type="number" aria-label={`${field.label} current`} value={cur} readOnly={readOnly} onChange={(e) => onChange(`${field.bind}.current`, num(e.target.value))} />
            <span className="sep">/</span>
            <input type="number" aria-label={`${field.label} max`} value={max} readOnly={readOnly} onChange={(e) => onChange(`${field.bind}.max`, num(e.target.value))} />
          </div>
        </div>
      )
    }
    case 'inventory-grid': {
      const raw = read(character, field.bind)
      const total = field.cols * field.rows
      const slots: InventorySlot[] = Array.from({ length: total }, (_, i) => (Array.isArray(raw) ? (raw[i] as InventorySlot) ?? null : null))
      const labels = field.slotLabels ?? []
      return (
        <div className="field span-all">
          <span>{field.label}</span>
          <div className="grid" style={{ ['--grid-cols' as string]: field.cols }}>
            {slots.map((slot, i) => {
              const label = labels[i]
              if (isContinuation(slot)) {
                const owner = slots[slot.continuationOf]
                return (
                  <div key={i} className={`slot continuation${label ? ' labeled' : ''}`}>
                    {label && <span className="slot-label">{label}</span>}
                    <span>{isItem(owner) ? owner.name : ''} (cont.)</span>
                  </div>
                )
              }
              const item = isItem(slot) ? slot : null
              return (
                <div key={i} className={`slot${label ? ' labeled' : ''}${item ? ' filled' : ''}`}>
                  {label && <span className="slot-label">{label}</span>}
                  <input
                    type="text"
                    aria-label={`${field.label} slot ${i + 1}`}
                    placeholder="empty"
                    value={item?.name ?? ''}
                    readOnly={readOnly}
                    onChange={(e) => {
                      const name = e.target.value
                      onChange(`${field.bind}.${i}`, name === '' ? null : { ...(item ?? {}), name })
                    }}
                  />
                  {item && (
                    <div className="tags">
                      {typeof item.damage === 'string' && <span className="tag">{item.damage}</span>}
                      {typeof item.armor === 'number' && <span className="tag">armor {item.armor}</span>}
                      {typeof item.usage === 'number' && <span className="tag">{'●'.repeat(item.usage)}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )
    }
    case 'list': {
      const raw = read(character, field.bind)
      const items = Array.isArray(raw) ? raw : []
      const update = (next: unknown[]) => onChange(field.bind, next)
      return (
        <div className="field span-all">
          <span>{field.label}</span>
          <div className="list-items">
            {items.map((_, i) => (
              <div key={i} className="list-item">
                <div className="fields">
                  {field.item.map((sub, j) => (
                    <Field key={j} field={prefixBind(sub, `${field.bind}.${i}`)} character={character} onChange={onChange} onRoll={onRoll} readOnly={readOnly} />
                  ))}
                </div>
                {!readOnly && (
                  <button type="button" aria-label="remove" onClick={() => update(items.filter((_, k) => k !== i))}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" onClick={() => update([...items, {}])}>
                Add
              </button>
            )}
          </div>
        </div>
      )
    }
    case 'roll':
      return (
        <button type="button" className="roll" onClick={() => onRoll(field.formula, field.label)}>
          {field.label}
        </button>
      )
  }
}

function prefixBind(field: SheetField, prefix: string): SheetField {
  if (field.kind === 'roll') return field
  return { ...field, bind: `${prefix}.${field.bind}` } as SheetField
}
