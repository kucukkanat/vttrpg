/**
 * Mounts a registry panel under a host-provided header row (sheet title, drawer title, section
 * toggle). Panels render their own `<h3>` with a title and action buttons; `.hosted` CSS moves that
 * `<h3>` into the header row and hides its title text, so the host header is the only title and
 * the panel's buttons (Tokens "+", Skills "Cancel") stay reachable. Panels are not changed.
 *
 * The relocated actions are positioned over the header, so their width is published as
 * `--actions-w` and the host title stops short of them instead of running underneath.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'

export function PanelHost({ def, controller, head, className = '' }: {
  def: PanelDef
  controller: GameController
  head?: ReactNode
  className?: string
}) {
  const Panel = def.component
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let watched: Element | null = null
    const publish = () => {
      const w = watched ? Math.ceil(watched.getBoundingClientRect().width) : 0
      host.style.setProperty('--actions-w', `${w}px`)
    }
    const sizes = new ResizeObserver(publish)
    const bind = () => {
      const h3 = host.querySelector(':scope > .panel > h3')
      if (h3 === watched) return
      if (watched) sizes.unobserve(watched)
      watched = h3
      if (h3) sizes.observe(h3)
      publish()
    }
    // Panels swap their <h3> when they change view (list ↔ editor), so rebind on DOM changes.
    const swaps = new MutationObserver(bind)
    swaps.observe(host, { childList: true, subtree: true })
    bind()
    return () => { sizes.disconnect(); swaps.disconnect() }
  }, [])
  return (
    <div ref={ref} className={`hosted ${className}`.trim()} data-panel={def.id}>
      {head}
      <Panel controller={controller} />
    </div>
  )
}
