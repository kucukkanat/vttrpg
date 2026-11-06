/**
 * Keyboard shortcut reference. Opens on `?` (desktop) or the chat panel's "?" button through the
 * `vtt:shortcuts` window event, so it mounts with one line and needs no shell state. Esc, the
 * close button or a tap on the backdrop closes it; focus returns to where it was.
 */
import { useEffect, useRef, useState } from 'react'
import { SHORTCUT_GROUPS, SHORTCUTS, SHORTCUTS_EVENT, type Shortcut } from './useShortcuts'
import './ShortcutsOverlay.css'

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onToggle = (e: Event) => {
      const want = (e as CustomEvent<{ open?: boolean }>).detail?.open
      setOpen((o) => (want === undefined ? !o : want))
    }
    window.addEventListener(SHORTCUTS_EVENT, onToggle)
    return () => window.removeEventListener(SHORTCUTS_EVENT, onToggle)
  }, [])

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    // Capture phase so the table's own Esc (deselect) does not fire while the overlay is up.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      returnTo.current?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="shortcuts-backdrop" onClick={() => setOpen(false)}>
      <div className="shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button type="button" className="icon shortcuts-close" ref={closeBtn} aria-label="Close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <ShortcutList shortcuts={SHORTCUTS} />
        <p className="shortcuts-note muted small">Keys are ignored while typing in a field. Panel and chat keys need the desktop layout; table keys work with any keyboard.</p>
      </div>
    </div>
  )
}

export function ShortcutList({ shortcuts }: { shortcuts: readonly Shortcut[] }) {
  return (
    <div className="shortcuts-groups">
      {SHORTCUT_GROUPS.map((group) => {
        const rows = shortcuts.filter((s) => s.group === group)
        if (!rows.length) return null
        return (
          <section key={group} className="shortcuts-group" aria-label={group}>
            <h3>{group}</h3>
            <dl>
              {rows.map((s) => (
                <div key={`${group}:${s.keys}`} className="shortcut">
                  <dt><Keys keys={s.keys} /></dt>
                  <dd>{s.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        )
      })}
    </div>
  )
}

/** "[ / ]" renders as two keycaps with a slash between; "Cmd/Ctrl+Z" stays one keycap. */
function Keys({ keys }: { keys: string }) {
  const parts = keys.split(' / ')
  return (
    <>
      {parts.map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="muted"> / </span>}
          <kbd>{k}</kbd>
        </span>
      ))}
    </>
  )
}
