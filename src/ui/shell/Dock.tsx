/**
 * Bottom of the table: the edit bar while edit mode is on (or props are selected in Build), otherwise
 * the selected token's skill bar (not in Build: the Inspector edits the token there).
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
  // Build with props selected shows the edit bar too (gizmo modes, advanced, the inspector).
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
      {editMode ? <EditBar controller={controller} /> : building ? null : <SkillBar controller={controller} />}
    </div>
  )
}
