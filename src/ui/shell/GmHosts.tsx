/**
 * The GM's two editing hosts around the board (docs/UX.md "Library and Inspector"):
 *
 *   LibraryHost    left edge, tablet and desktop: folded, a slim rail with "Library" and the Edit
 *                  pencil; open, the Library dock (src/ui/build/LibraryDock.tsx, loaded on first
 *                  open). Esc or the fold button folds it; open or folded is remembered per device.
 *   InspectorHost  right: the Inspector card while something is selected or a kit piece or
 *                  creatures are in hand (src/ui/build/Inspector.tsx, loaded on first use). On
 *                  phones it opens and closes the Inspector sheet instead.
 */
import { useEditMode } from './editMode'
import { lazy, Suspense, useEffect, useRef } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { inspectorContext, type InspectorContext } from '../build/inspectorContext'
import { useTableLayout } from './tableLayout'
import { useEscape } from './TableChrome'
import { EditToggle } from './EditToggle'
import { Icon } from '../icons'

const LibraryDock = lazy(() => import('../build/LibraryDock'))
const InspectorCard = lazy(() => import('../build/Inspector'))

/** What the Inspector would show now, or null (no Inspector). */
export function useInspectorContext(): InspectorContext | null {
  const selection = useGame((s) => s.selection)
  const propCount = useGame((s) => s.propSelection.length)
  const selectedToken = useGame((s) => s.selectedToken)
  const tool = useBuildUi((s) => s.tool)
  const editing = useEditMode((s) => s.on)
  return inspectorContext({ selection, propCount, selectedToken, tool, editing })
}

export function LibraryHost({ controller }: { controller: GameController }) {
  const open = useTableLayout((s) => s.libraryOpen)
  const card = useTableLayout((s) => s.card)
  const set = useTableLayout((s) => s.set)
  const holding = useBuildUi((s) => s.tool !== null)
  const propsSelected = useGame((s) => s.propSelection.length > 0)
  // Esc folds the dock once nothing else wants it: no card, nothing in hand, no props selected.
  useEscape(open && !card && !holding && !propsSelected, () => set({ libraryOpen: false }))
  if (!open) {
    return (
      <div className="lib-rail" role="group" aria-label="Library">
        <button type="button" className="lib-rail-open" onClick={() => set({ libraryOpen: true })} aria-label="Open the Library" title="Library: everything you can add">
          <Icon name="cube" size={18} />
          <span className="lib-rail-word">Library</span>
        </button>
        <EditToggle />
      </div>
    )
  }
  return (
    <Suspense fallback={<div className="lib-dock lib-dock--loading skin-paper" aria-busy="true" />}>
      <LibraryDock controller={controller} />
    </Suspense>
  )
}

export function InspectorHost({ controller, phone }: { controller: GameController; phone: boolean }) {
  const context = useInspectorContext()
  const kind = context?.kind ?? null
  const last = useRef<string | null>(null)
  // Phones: the Inspector is a sheet that comes with a selection and goes with it.
  useEffect(() => {
    if (!phone) return
    const was = last.current
    last.current = kind
    const s = useTableLayout.getState()
    if (kind && !was && !s.phone && !s.card && !s.scrollOpen) s.set({ phone: 'inspector' })
    if (!kind && s.phone === 'inspector') s.set({ phone: null })
  }, [phone, kind])
  if (phone || !context) return null
  return (
    <Suspense fallback={null}>
      <InspectorCard controller={controller} context={context} />
    </Suspense>
  )
}
