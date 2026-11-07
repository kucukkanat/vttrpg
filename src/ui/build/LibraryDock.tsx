/**
 * Build's Library dock on the left: the shelf switcher (Models · Kit · Creatures · Saved, from
 * `useLibraryView`) over the Library panel, which fills each shelf. Folds to a narrow rail.
 */
import type { GameController } from '../controller'
import { LibraryPanel } from '../library/LibraryPanel'
import { LIBRARY_SHELVES, useLibraryView } from '../library/libraryView'
import { useTableLayout } from '../shell/tableLayout'
import { Icon } from '../icons'

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
  const open = useTableLayout((s) => s.buildLibraryOpen)
  const set = useTableLayout((s) => s.set)
  if (!open) {
    return (
      <button type="button" className="bw-rail bw-rail--left" onClick={() => set({ buildLibraryOpen: true })} aria-label="Open the Library" title="Library: everything you can add">
        <Icon name="cube" size={18} />
        <span className="bw-rail-word">Library</span>
      </button>
    )
  }
  return (
    <aside className="bw-dock bw-dock--left skin-paper" aria-label="Library">
      <div className="paper-head bw-dock-head">
        <Icon name="cube" size={18} className="paper-glyph" />
        <h2 className="host-title paper-title">Library</h2>
        <button type="button" className="icon" aria-label="Fold the Library" title="Fold the Library" onClick={() => set({ buildLibraryOpen: false })}><Icon name="chevron-left" size={18} /></button>
      </div>
      <ShelfRow />
      <div className="bw-dock-body bw-lib-body">
        <LibraryPanel controller={controller} />
      </div>
    </aside>
  )
}
