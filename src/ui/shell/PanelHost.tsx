/**
 * Mounts a registry panel under a host-provided header row (sheet title, drawer title, section
 * toggle). Panels render their own `<h3>` with a title and action buttons; `.hosted` CSS moves that
 * `<h3>` into the header row and hides its title text, so the host header is the only title and
 * the panel's buttons (Tokens "+", Skills "Cancel") stay reachable. Panels are not changed.
 */
import type { ReactNode } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'

export function PanelHost({ def, controller, head, className = '' }: {
  def: PanelDef
  controller: GameController
  head?: ReactNode
  className?: string
}) {
  const Panel = def.component
  return (
    <div className={`hosted ${className}`.trim()} data-panel={def.id}>
      {head}
      <Panel controller={controller} />
    </div>
  )
}
