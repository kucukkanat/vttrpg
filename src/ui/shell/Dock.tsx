/**
 * Bottom of the table: the edit bar while edit mode is on (or props are selected with the Edit
 * toggle on), otherwise the selected token's skill bar.
 * Its height is published as `--dock-h` on the table so the toast stack sits above it.
 */
import { useLayoutEffect, useRef } from 'react'
import type { GameController } from '../controller'
import { useTableUi } from '@/table/tableState'
import { useGame } from '@/state/store'
import { SkillBar } from '../skillbar/SkillBar'
import { EditBar } from './EditBar'
import './Dock.css'

export function Dock({ controller }: { controller: GameController }) {
  // Props selected with Edit on show the edit bar too (snap, the gizmo mode, advanced, Deselect).
  const editing = useTableUi((s) => s.editMode)
  const building = useTableUi((s) => s.buildMode)
  const propsSelected = useGame((s) => s.propSelection.length > 0)
  const editMode = editing || (building && propsSelected)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const table = el?.closest<HTMLElement>('.table')
    if (!el || !table || typeof ResizeObserver === 'undefined') return
    const publish = () => table.style.setProperty('--dock-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    publish()
    return () => { ro.disconnect(); table.style.removeProperty('--dock-h') }
  }, [])
  return (
    <div className="dock" ref={ref}>
      {editMode ? <EditBar controller={controller} /> : <SkillBar controller={controller} />}
    </div>
  )
}
