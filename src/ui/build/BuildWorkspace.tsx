/**
 * The Build workspace (GM, tablet and desktop): mounted by the shell while the GM is in Build,
 * loaded on first use. The scene bar along the top, the Library dock on the left, the Inspector
 * dock on the right and the tool strip at the bottom; each dock folds away (per device).
 *
 *   ┌ Scene ▾ · Level ▲▼ · ✂ · ↶ ↷ · budget · Done ┐
 *   │ Library │            BOARD            │ Inspector │
 *   │         │  [Select Paint Walls Light Fog]  │           │
 */
import type { GameController } from '../controller'
import { useTableLayout } from '../shell/tableLayout'
import { Icon } from '../icons'
import { SceneBar } from './SceneBar'
import { LibraryDock } from './LibraryDock'
import { InspectorBody, useInspectorContext, useInspectorHeading } from './Inspector'
import { ToolStrip, useStripKeys } from './ToolStrip'
import './buildWorkspace.css'

function InspectorDock({ controller }: { controller: GameController }) {
  const open = useTableLayout((s) => s.buildInspectorOpen)
  const set = useTableLayout((s) => s.set)
  const context = useInspectorContext()
  const heading = useInspectorHeading(context)
  if (!open) {
    return (
      <button type="button" className="bw-rail bw-rail--right" onClick={() => set({ buildInspectorOpen: true })} aria-label={`Open the Inspector: ${heading.kind}`} title="Inspector">
        <Icon name="sheet" size={18} />
        <span className="bw-rail-word">{heading.kind}</span>
      </button>
    )
  }
  return (
    <aside className="bw-dock bw-dock--right skin-paper" aria-label="Inspector">
      <div className="paper-head bw-dock-head">
        <span className="bw-kind">{heading.kind}</span>
        <h2 className="host-title paper-title bw-insp-name">{heading.name ?? ''}</h2>
        <button type="button" className="icon" aria-label="Fold the Inspector" title="Fold the Inspector" onClick={() => set({ buildInspectorOpen: false })}><Icon name="chevron-right" size={18} /></button>
      </div>
      <div className="bw-dock-body bw-insp-body panel" key={context.kind === 'tool' ? `tool:${context.tool}` : context.kind}>
        <InspectorBody controller={controller} context={context} />
      </div>
    </aside>
  )
}

export function BuildWorkspace({ controller }: { controller: GameController }) {
  useStripKeys(true, false)
  return (
    <div className="bw" role="region" aria-label="Build">
      <SceneBar controller={controller} />
      <LibraryDock controller={controller} />
      <InspectorDock controller={controller} />
      <ToolStrip />
    </div>
  )
}

export default BuildWorkspace
