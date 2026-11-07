import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { colorName } from './colorName'
import { dieLabel, dieViews } from './dice/diceFaces'
import { DiceRow } from './dice/DiceFace'

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
export function ListRow({ selected = false, onSelect, label, title, expanded, trailing, className, style, rowProps, children }: {
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
  /** Extra handlers on the row's `<li>` (hover, focus). */
  rowProps?: Omit<HTMLAttributes<HTMLLIElement>, 'className' | 'style' | 'children'>
  children: ReactNode
}) {
  const cls = ['list-row', selected ? 'selected' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <li {...rowProps} className={cls} style={style}>
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
 * The individual dice of a roll drawn as small faces (d6 pips, polygon badges for other dice), with
 * dice that `kh`/`kl` dropped faded and struck, natural max/min highlighted, and the values spoken
 * as one label. `formula` is the roll's text (e.g. "4d6kh3"); `sides` is optional per die.
 */
export function DiceValues({ formula, dice, className }: { formula: string; dice: { value: number; sides?: number }[]; className?: string }) {
  const views = dieViews(formula, dice)
  if (!views.length) return null
  return (
    <span className={['dice-values', className ?? ''].filter(Boolean).join(' ')} role="img" aria-label={`Dice: ${views.map(dieLabel).join('; ')}`}>
      <DiceRow dice={views} />
    </span>
  )
}
