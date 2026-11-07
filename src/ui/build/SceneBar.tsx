/**
 * Build's scene bar along the top of the board: the scene switcher (the scene list with add,
 * Switch (go live), Preview, rename and remove), the level being built and the cutaway (PgUp /
 * PgDn), undo and redo, the scene budget meter, and Done, back to Play.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { describeOutcome, redoLast, undoLast, useUndo } from '@/state/undo'
import { stepLevel, useKitUi } from '@/table/kits/kitState'
import { ScenesPanel } from '../panels/ScenesPanel'
import { BudgetMeter } from '../library/BudgetMeter'
import { setTableMode } from '../shell/tableLayout'
import { pushToast } from '../toasts'
import { Icon } from '../icons'

const runUndo = (dir: 'undo' | 'redo') => void (dir === 'undo' ? undoLast() : redoLast()).then((o) => o && pushToast({ text: describeOutcome(o, dir), ttl: o.note ? 5000 : 2500 }))

/** The scene switcher: the live scene's name, opening the scene list as a popover. */
export function SceneSwitcher({ controller }: { controller: GameController }) {
  const name = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene]?.name : undefined))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    const id = setTimeout(() => window.addEventListener('pointerdown', down), 0)
    window.addEventListener('keydown', key, true)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key, true) }
  }, [open])
  return (
    <div className="bw-switcher" ref={ref}>
      <button type="button" className="bw-scene-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Scenes: switch, add, rename, remove">
        <Icon name="map" size={16} />
        <span className="bw-scene-name">{name ?? 'No scene'}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="bw-pop skin-paper" role="dialog" aria-label="Scenes">
          <ScenesPanel controller={controller} />
        </div>
      )}
    </div>
  )
}

/** The level being built (▲ ▼, PgUp / PgDn) and the cutaway (auto follows the token, or cut at the level). */
export function LevelControl() {
  const level = useKitUi((s) => s.level)
  const cutaway = useKitUi((s) => s.cutaway)
  const set = useKitUi((s) => s.set)
  return (
    <div className="bw-levels" role="group" aria-label="Level">
      <button type="button" className="bw-bar-btn" aria-label="Level down" title="Build one level down (PgDn)" disabled={level === 0} onClick={() => stepLevel(-1)}>▼</button>
      <span className="bw-level" aria-live="polite">Level {level}</span>
      <button type="button" className="bw-bar-btn" aria-label="Level up" title="Build one level up (PgUp)" onClick={() => stepLevel(1)}>▲</button>
      <button type="button" className={`bw-bar-btn${cutaway !== null ? ' on' : ''}`} aria-pressed={cutaway !== null}
        title={cutaway === null ? 'Cutaway follows the selected token (or the level being built); click to cut at this level' : `Everything above level ${cutaway} is hidden; click to follow the token again`}
        onClick={() => set({ cutaway: cutaway === null ? level : null })}>
        ✂ {cutaway === null ? 'auto' : `≤ ${cutaway}`}
      </button>
    </div>
  )
}

export function UndoRedo() {
  const canUndo = useUndo((s) => s.stack.length > 0)
  const canRedo = useUndo((s) => s.redo.length > 0)
  return (
    <div className="bw-undo" role="group" aria-label="History">
      <button type="button" className="bw-bar-btn" disabled={!canUndo} aria-label="Undo" title="Undo your last edit (Cmd/Ctrl+Z)" onClick={() => runUndo('undo')}>↶</button>
      <button type="button" className="bw-bar-btn" disabled={!canRedo} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)" onClick={() => runUndo('redo')}>↷</button>
    </div>
  )
}

export function SceneBar({ controller }: { controller: GameController }) {
  return (
    <div className="bw-scenebar" role="toolbar" aria-label="Scene">
      <SceneSwitcher controller={controller} />
      <span className="bw-sep" aria-hidden />
      <LevelControl />
      <span className="bw-sep" aria-hidden />
      <UndoRedo />
      <div className="bw-budget"><BudgetMeter /></div>
      <button type="button" className="bw-done" onClick={() => setTableMode('play')} title="Back to Play">
        <Icon name="check" size={16} /> Done
      </button>
    </div>
  )
}
