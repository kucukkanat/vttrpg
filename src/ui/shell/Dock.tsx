/**
 * Bottom of the table: the edit bar while edit mode is on, otherwise the selected token's skill bar.
 * Its height is published as `--dock-h` on the table so the toast stack sits above it.
 */
import { useLayoutEffect, useRef } from 'react'
import type { GameController } from '../controller'
import { useTableUi } from '@/table/tableState'
import { SkillBar } from '../skillbar/SkillBar'
import { EditBar } from './EditBar'
import './Dock.css'

export function Dock({ controller }: { controller: GameController }) {
  const editMode = useTableUi((s) => s.editMode)
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
