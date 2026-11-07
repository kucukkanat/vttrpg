/**
 * Build on a phone: the bottom bar's Library, Tools, Inspector and Scene each open one sheet.
 * Picking a Library card or a tool closes the sheet so the next tap lands on the board. Kit
 * painting and imports stay on tablets and desktops.
 */
import type { GameController } from '../controller'
import { LibraryPanel } from '../library/LibraryPanel'
import { ScenesPanel } from '../panels/ScenesPanel'
import { BudgetMeter } from '../library/BudgetMeter'
import { useTableLayout } from '../shell/tableLayout'
import { ShelfRow } from './LibraryDock'
import { InspectorBody, useInspectorContext, useInspectorHeading } from './Inspector'
import { LevelControl, UndoRedo } from './SceneBar'
import { ToolStrip, useStripKeys } from './ToolStrip'
import './buildWorkspace.css'

export type BuildPhoneSheetId = 'library' | 'tools' | 'inspector' | 'scene'

export const BUILD_SHEET_TITLES: Record<BuildPhoneSheetId, string> = { library: 'Library', tools: 'Build tools', inspector: 'Inspector', scene: 'Scene' }

function PhoneInspector({ controller }: { controller: GameController }) {
  const context = useInspectorContext()
  const heading = useInspectorHeading(context)
  return (
    <div className="bw-phone-insp panel">
      <p className="bw-phone-head"><span className="bw-kind">{heading.kind}</span> <strong>{heading.name ?? ''}</strong></p>
      <InspectorBody controller={controller} context={context} />
    </div>
  )
}

export function BuildPhoneSheet({ controller, sheet }: { controller: GameController; sheet: BuildPhoneSheetId }) {
  const close = () => useTableLayout.getState().set({ phone: null })
  useStripKeys(true, true)
  switch (sheet) {
    case 'library':
      return <div className="bw-phone-lib"><ShelfRow /><LibraryPanel controller={controller} /></div>
    case 'tools':
      return <div className="bw-phone-tools"><ToolStrip phone onPicked={close} /><p className="muted small">Pick a tool, then draw on the board; its options are in the Inspector. Kit painting needs a tablet or a desktop.</p></div>
    case 'inspector':
      return <PhoneInspector controller={controller} />
    case 'scene':
      return (
        <div className="bw-phone-scene">
          <div className="row bw-row"><LevelControl /><UndoRedo /></div>
          <BudgetMeter />
          <ScenesPanel controller={controller} />
        </div>
      )
  }
}

export default BuildPhoneSheet
