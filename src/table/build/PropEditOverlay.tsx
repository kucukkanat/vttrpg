/**
 * DOM over the table for prop editing: the selection box while it is being dragged, and the
 * readout while a number is typed after X / Y / Z ("Turn · Y · 45°", Enter applies, Esc cancels).
 */
import { useGame } from '@/state/store'
import { useTableUi } from '../tableState'
import { describeEntry, MODE_LABEL } from './transformKeys'
import { isCoarsePointer } from './editRuntime'

export function PropEditOverlay({ gm }: { gm: boolean }) {
  const box = useTableUi((s) => s.boxSelect)
  const entry = useTableUi((s) => s.transformEntry)
  const mode = useTableUi((s) => s.gizmoMode)
  const count = useGame((s) => s.propSelection.length)
  const live = useTableUi((s) => (s.buildMode || s.editMode) && !s.editDrag)
  return (
    <>
      {box && (
        <div aria-hidden="true" style={{
          position: 'absolute', left: box.minX, top: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY,
          border: '1.5px dashed var(--select, #f3ead8)', background: 'rgba(243, 234, 216, 0.08)', pointerEvents: 'none', borderRadius: 2,
        }} />
      )}
      {gm && live && count > 0 && (entry || !isCoarsePointer()) && (
        <div role="status" aria-live="polite" style={{
          position: 'absolute', left: '50%', top: 'calc(env(safe-area-inset-top, 0px) + 64px)', transform: 'translateX(-50%)',
          padding: '4px 10px', borderRadius: 6, fontSize: 13, background: 'var(--scrim, rgba(0,0,0,0.6))', color: 'var(--on-glass, #f3ead8)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {entry
            ? <>{describeEntry(mode, entry)} <span style={{ opacity: 0.7 }}>· Enter applies, Esc cancels</span></>
            : <>{count > 1 ? `${count} props` : '1 prop'} · {MODE_LABEL[mode]} <span style={{ opacity: 0.7 }}>· Tab mode · X/Y/Z type · R turn · End drop</span></>}
        </div>
      )}
    </>
  )
}
