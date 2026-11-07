/**
 * The GM's Inspector: a slim card on the right while something is selected (a prop or several, a
 * token, a scene part) or a kit piece or creatures are in hand (inspectorContext.ts). Closed on
 * deselect; nothing shows when nothing is selected. Undo and redo sit in its header. On phones the
 * same body is the Inspector sheet. Loaded on first use (the shell's InspectorHost decides when).
 */
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { describeOutcome, redoLast, undoLast, useUndo } from '@/state/undo'
import { useBuildUi } from '@/table/build/buildState'
import { useKitUi } from '@/table/kits/kitState'
import { Selected } from '../panels/ObjectPanel'
import { pushToast } from '../toasts'
import { Icon } from '../icons'
import { useInspectorContext } from '../shell/GmHosts'
import { contextTitle, type InspectorContext } from './inspectorContext'
import { Fold } from './Fold'
import { PropPane, PropsPane } from './panes/PropPane'
import { TokenEditor } from './panes/TokenPane'
import { PaintOptions } from './panes/PaintOptions'
import './inspector.css'

/** The Inspector's body for a context (the card and the phone sheet both use it). */
export function InspectorBody({ controller, context }: { controller: GameController; context: InspectorContext }) {
  const token = useGame((s) => (s.selectedToken ? s.tokens[s.selectedToken] : undefined))
  const selection = useGame((s) => s.selection)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  switch (context.kind) {
    case 'prop': return <PropPane controller={controller} />
    case 'props': return <PropsPane controller={controller} />
    case 'token': return token ? <TokenEditor key={token.id} controller={controller} token={token} Section={Fold} /> : null
    case 'node': return selection && scene ? <Selected controller={controller} selection={selection} scene={scene} sceneId={scene.id} onDeselect={deselect} /> : null
    case 'paint': return <PaintOptions />
    case 'creature': return <CreatureOptions />
  }
}

/** Creatures in hand: hidden until revealed by default; the toggle places them visible. */
function CreatureOptions() {
  const visible = useBuildUi((s) => s.placeVisible)
  const held = useBuildUi((s) => s.creatures)
  return (
    <>
      {held && <p className="small bw-note">Holding <strong>{held.title}</strong>{held.tokens.length > 1 ? ` (${held.tokens.length} tokens)` : ''}. Click the board to place; Esc puts it down.</p>}
      <label className="check">
        <input type="checkbox" checked={visible} onChange={(e) => useBuildUi.getState().set({ placeVisible: e.target.checked })} />
        Place visible to players
      </label>
      <p className="muted small bw-note">{visible ? 'Players see them as soon as they land.' : 'Hidden until you reveal them (the eye in the scene list, or the token menu).'}</p>
    </>
  )
}

/** The heading line: what the Inspector is showing, and whose name. */
export function useInspectorHeading(context: InspectorContext | null): { kind: string; name: string | null } {
  const name = useGame((s) => {
    if (context?.kind === 'prop') { const id = s.propSelection[s.propSelection.length - 1]; return id ? s.props[id]?.name ?? null : null }
    if (context?.kind === 'token') return s.selectedToken ? s.tokens[s.selectedToken]?.name ?? null : null
    if (context?.kind === 'node') return s.selection?.kind === 'node' ? s.selection.id : null
    return null
  })
  return { kind: context ? contextTitle(context) : '', name }
}

/** Close the Inspector: let go of the selection and of a kit piece or creatures in hand. */
export function deselect(): void {
  const build = useBuildUi.getState()
  if (build.tool === 'kit' || build.tool === 'creature') build.set({ tool: null })
  if (useKitUi.getState().tool) useKitUi.getState().set({ tool: null })
  const g = useGame.getState()
  g.clearPropSelection()
  g.setSelection(null)
}

const runUndo = (dir: 'undo' | 'redo') => void (dir === 'undo' ? undoLast() : redoLast()).then((o) => o && pushToast({ text: describeOutcome(o, dir), ttl: o.note ? 5000 : 2500 }))

/** Undo and redo of the GM's own edits (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z). */
export function UndoRedo() {
  const canUndo = useUndo((s) => s.stack.length > 0)
  const canRedo = useUndo((s) => s.redo.length > 0)
  return (
    <div className="insp-history" role="group" aria-label="History">
      <button type="button" className="icon" disabled={!canUndo} aria-label="Undo" title="Undo your last edit (Cmd/Ctrl+Z)" onClick={() => runUndo('undo')}><Icon name="undo" size={16} /></button>
      <button type="button" className="icon" disabled={!canRedo} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)" onClick={() => runUndo('redo')}><Icon name="redo" size={16} /></button>
    </div>
  )
}

/** The desktop and tablet card, right of the board. */
export function InspectorCard({ controller, context }: { controller: GameController; context: InspectorContext }) {
  const heading = useInspectorHeading(context)
  return (
    <aside className="insp skin-paper" aria-label={`Inspector: ${heading.kind}`}>
      <div className="paper-head insp-head">
        <span className="bw-kind">{heading.kind}</span>
        <h2 className="host-title paper-title insp-name">{heading.name ?? ''}</h2>
        <UndoRedo />
        <button type="button" className="icon" aria-label="Close the Inspector (deselect)" title="Deselect (Esc)" onClick={deselect}><Icon name="close" size={16} /></button>
      </div>
      <div className="insp-body panel" key={context.kind}>
        <InspectorBody controller={controller} context={context} />
      </div>
    </aside>
  )
}

/** The phone sheet's body: the heading line, undo and redo, then the context's fields. */
export function InspectorSheet({ controller }: { controller: GameController }) {
  const context = useInspectorContext()
  const heading = useInspectorHeading(context)
  if (!context) return <p className="muted small insp-empty">Nothing selected.</p>
  return (
    <div className="insp-phone panel">
      <div className="insp-phone-head"><span className="bw-kind">{heading.kind}</span> <strong className="insp-name">{heading.name ?? ''}</strong><UndoRedo /></div>
      <InspectorBody key={context.kind} controller={controller} context={context} />
    </div>
  )
}

export default InspectorCard
