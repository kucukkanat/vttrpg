import type { CSSProperties, ReactNode } from 'react'
import { colorName } from './colorName'
import { keptMask } from '@/dice/kept'

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="shell">
      <h1>{title}</h1>
      {children}
    </main>
  )
}

/**
 * A row in a `.list`: the whole row is one real `<button>` (keyboard reachable, 44 px on touch,
 * `aria-pressed` when selected) and `trailing` holds controls that must not nest inside it. Without
 * `onSelect` the row is static. Children are flex items; text spans get ellipsis from `.list` CSS.
 */
export function ListRow({ selected = false, onSelect, label, title, expanded, trailing, className, style, children }: {
  selected?: boolean
  onSelect?(): void
  /** Accessible name when the visible text is not enough. */
  label?: string
  title?: string
  /** For rows that open an inline editor beneath them. */
  expanded?: boolean
  /** Buttons or badges rendered after the row button, outside it. */
  trailing?: ReactNode
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const cls = ['list-row', selected ? 'selected' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <li className={cls} style={style}>
      {onSelect ? (
        <button type="button" className="list-row-main" aria-pressed={expanded === undefined ? selected : undefined} aria-expanded={expanded} aria-label={label} title={title} onClick={onSelect}>
          {children}
        </button>
      ) : (
        <div className="list-row-main" aria-label={label} title={title}>{children}</div>
      )}
      {trailing}
    </li>
  )
}

/** Colour swatch button with a spoken colour name; 44 px hit area on touch, drawn by `.swatch`. */
export function Swatch({ color, on = false, onPick }: { color: string; on?: boolean; onPick(color: string): void }) {
  const name = colorName(color)
  return (
    <button type="button" className={`swatch ${on ? 'on' : ''}`} style={{ background: color }} aria-label={name} aria-pressed={on} title={name} onClick={() => onPick(color)} />
  )
}

/**
 * The individual dice of a roll, "[5, 2, 1]", with dice that `kh`/`kl` dropped struck through and
 * named for screen readers. `formula` is the roll's text (e.g. "4d6kh3").
 */
export function DiceValues({ formula, dice, className }: { formula: string; dice: { value: number }[]; className?: string }) {
  const kept = keptMask(formula, dice)
  return (
    <span className={className}>
      [
      {dice.map((d, i) => (
        <span key={i}>
          {i > 0 && ', '}
          {kept[i] ? d.value : <s className="die dropped" aria-label={`${d.value}, dropped`}>{d.value}</s>}
        </span>
      ))}
      ]
    </span>
  )
}
