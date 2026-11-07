/**
 * The table's ⋯ menu in the top bar: Zen (hide everything over the table; Z, Esc or the corner
 * button brings it back), the layout presets (layoutPresets.ts), the game file, the shortcuts and
 * Leave. On phones it also holds Invite. Also the corner restore button shown while Zen or the
 * Display preset is on.
 */
import { useEffect, useRef, useState } from 'react'
import { LAYOUT_PRESETS, type LayoutPresetId } from './layoutPresets'
import { isTypingTarget, toggleShortcutsOverlay } from './useShortcuts'
import './ViewMenu.css'
import { Icon } from '@/ui/icons'

export function ViewMenu({ preset, onPreset, onZen, onExport, onInvite, onLeave }: {
  preset: LayoutPresetId
  onPreset(id: LayoutPresetId): void
  onZen(): void
  onExport?(): void
  onInvite?(): void
  onLeave(): void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (run: () => void) => () => { setOpen(false); run() }
  return (
    <div className="menu view-menu" ref={ref}>
      <button type="button" className="icon t-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Menu" title="View, game file, leave" onClick={() => setOpen((o) => !o)}><Icon name="menu" /></button>
      {open && (
        <div className="menu-list skin-paper" role="menu">
          {onInvite && <button type="button" role="menuitem" onClick={pick(onInvite)}>Invite players</button>}
          <button type="button" role="menuitem" onClick={pick(onZen)}>
            Zen mode <span className="key-hint">Z</span>
          </button>
          <div className="menu-info muted small">Layout</div>
          {LAYOUT_PRESETS.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={preset === p.id} title={p.hint} onClick={pick(() => onPreset(p.id))}>
              <span aria-hidden className="view-check">{preset === p.id ? <Icon name="check" size={16} /> : null}</span>
              <span className="view-item"><span>{p.label}</span><span className="muted small">{p.hint}</span></span>
            </button>
          ))}
          <div className="menu-info muted small">Game</div>
          {onExport && (
            <button type="button" role="menuitem" onClick={pick(onExport)}>
              <span aria-hidden className="view-check" />
              <span className="view-item"><span>Export game file</span><span className="muted small">Everything, with maps and models, to keep or import elsewhere</span></span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(() => toggleShortcutsOverlay(true))}>Keyboard shortcuts <span className="key-hint">?</span></button>
          <button type="button" role="menuitem" className="danger" onClick={pick(onLeave)}>Leave game</button>
        </div>
      )}
    </div>
  )
}

/** Corner button that brings the chrome back; the only control left in Zen and Display. */
export function RestoreChrome({ label, onRestore }: { label: string; onRestore(): void }) {
  return (
    <button type="button" className="chrome-restore" onClick={onRestore} aria-label={label} title={label}>
      <Icon name="layout" size={16} /><span className="chrome-restore-word">{label}</span>
    </button>
  )
}

/** Z toggles Zen on any layout with a keyboard; Esc leaves it. Ignored while typing or with modifiers. */
export function useZenKeys(zen: boolean, setZen: (on: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(document.activeElement)) return
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); setZen(!zen) }
      else if (e.key === 'Escape' && zen) setZen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zen, setZen])
}
