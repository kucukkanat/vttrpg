/**
 * View menu in the top bar: Zen mode (hide all chrome over the table; Z, Esc or the corner
 * button brings it back) and the layout presets (see layoutPresets.ts). Also the corner
 * restore button shown while Zen or the Display preset is on.
 */
import { useEffect, useRef, useState } from 'react'
import { presetsFor, type LayoutPresetId } from './layoutPresets'
import { isTypingTarget } from './useShortcuts'
import './ViewMenu.css'

export function ViewMenu({ isGm, preset, onPreset, onZen }: { isGm: boolean; preset: LayoutPresetId; onPreset(id: LayoutPresetId): void; onZen(): void }) {
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
  return (
    <div className="menu view-menu" ref={ref}>
      <button type="button" className="icon" aria-haspopup="menu" aria-expanded={open} aria-label="View and layout" title="View and layout" onClick={() => setOpen((o) => !o)}>▣</button>
      {open && (
        <div className="menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onZen() }}>
            Zen mode <span className="key-hint">Z</span>
          </button>
          <div className="menu-info muted small">Layout</div>
          {presetsFor(isGm).map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={preset === p.id} title={p.hint}
              onClick={() => { setOpen(false); onPreset(p.id) }}>
              <span aria-hidden className="view-check">{preset === p.id ? '✓' : ''}</span>
              <span className="view-item"><span>{p.label}</span><span className="muted small">{p.hint}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Corner button that brings the chrome back; the only control left in Zen and Display. */
export function RestoreChrome({ label, onRestore }: { label: string; onRestore(): void }) {
  return (
    <button type="button" className="chrome-restore" onClick={onRestore} aria-label={label} title={label}>
      <span aria-hidden>▣</span><span className="chrome-restore-word">{label}</span>
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
