/**
 * The GM's Library dock, open (the shell draws the folded rail and loads this on first open): the
 * Edit pencil and the fold button in the header, the shelf row (`LIBRARY_SHELVES`, from
 * `useLibraryView`) over the Library panel, which fills each shelf, and the scene budget meter in
 * the footer. On phones the shelf row and the panel are the Library sheet.
 */
import type { GameController } from '../controller'
import { LibraryPanel } from '../library/LibraryPanel'
import { BudgetMeter } from '../library/BudgetMeter'
import { LIBRARY_SHELVES, useLibraryView } from '../library/libraryView'
import { useTableLayout } from '../shell/tableLayout'
import { EditToggle } from '../shell/EditToggle'
import { Icon } from '../icons'
import './inspector.css'

export function ShelfRow() {
  const shelf = useLibraryView((s) => s.shelf)
  const set = useLibraryView((s) => s.set)
  return (
    <div className="bw-shelves" role="tablist" aria-label="Library shelf">
      {LIBRARY_SHELVES.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={shelf === s.id} className={`bw-shelf${shelf === s.id ? ' on' : ''}`} onClick={() => set({ shelf: s.id })}>{s.label}</button>
      ))}
    </div>
  )
}

export function LibraryDock({ controller }: { controller: GameController }) {
  const set = useTableLayout((s) => s.set)
  return (
    <aside className="lib-dock skin-paper" aria-label="Library">
      <div className="paper-head lib-dock-head">
        <Icon name="cube" size={18} className="paper-glyph" />
        <h2 className="host-title paper-title">Library</h2>
        <EditToggle />
        <button type="button" className="icon" aria-label="Fold the Library" title="Fold the Library (Esc)" onClick={() => set({ libraryOpen: false })}><Icon name="chevron-left" size={18} /></button>
      </div>
      <ShelfRow />
      <div className="lib-dock-body bw-lib-body">
        <LibraryPanel controller={controller} bare />
      </div>
      <div className="lib-dock-foot"><BudgetMeter /></div>
    </aside>
  )
}

/** Phones: the Library as the one sheet. Picking a card closes the sheet so the next tap places. */
export function LibrarySheet({ controller }: { controller: GameController }) {
  return (
    <div className="lib-phone">
      <div className="lib-phone-head"><ShelfRow /><EditToggle /></div>
      <LibraryPanel controller={controller} bare />
    </div>
  )
}

export default LibraryDock
