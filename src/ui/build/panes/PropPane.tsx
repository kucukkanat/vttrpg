/**
 * The Inspector on a prop selection. One prop: name, solid, locked, its kind's part (a light, a
 * wall, a door: PropKindPanes.tsx), the transform (position,
 * rotation, scale; expressions such as 1.5*2 work), Save as group and Delete. Several props: what
 * is selected, the same transform applied to all, Save as group and Delete.
 */
import { useEffect, useState } from 'react'
import type { GameController } from '../../controller'
import type { Prop } from '@/core/doc'
import type { PropPatch } from '@/core/intents'
import { useGame } from '@/state/store'
import { PropInspector } from '../../panels/PropInspector'
import { saveSelectionAsGroup } from '../../library/groups'
import { pushToast } from '../../toasts'
import { Fold } from '../Fold'
import { PropKindPane } from './PropKindPanes'

function useSelectedProps(): Prop[] {
  const ids = useGame((s) => s.propSelection)
  const all = useGame((s) => s.props)
  return ids.map((id) => all[id]).filter((p): p is Prop => !!p)
}

/** "Save as group" and "Delete" for the whole selection. */
function SelectionActions({ controller, props }: { controller: GameController; props: Prop[] }) {
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const id = await saveSelectionAsGroup(controller)
      pushToast({ text: id ? 'Saved as a group on the Library’s Saved shelf' : 'Select some props first', ttl: 2500 })
    } catch {
      pushToast({ text: 'Saving groups is not available yet', ttl: 2500 })
    } finally {
      setBusy(false)
    }
  }
  const remove = () => {
    void controller.dispatch({ type: 'props.remove', ids: props.map((p) => p.id) })
    useGame.getState().clearPropSelection()
  }
  return (
    <div className="row bw-row">
      <button type="button" className="tiny" disabled={busy} onClick={() => void save()} title="Keep these as one piece on the Library’s Saved shelf, to stamp elsewhere">Save as group</button>
      <button type="button" className="tiny danger" onClick={remove} title="Delete (Undo brings it back)">Delete</button>
    </div>
  )
}

export function PropPane({ controller }: { controller: GameController }) {
  const props = useSelectedProps()
  const prop = props[props.length - 1]
  const [name, setName] = useState(prop?.name ?? '')
  useEffect(() => setName(prop?.name ?? ''), [prop?.id, prop?.name])
  if (!prop) return null
  const patch = (p: PropPatch) => void controller.dispatch({ type: 'props.update', updates: [{ id: prop.id, patch: p }] })
  const commitName = () => { const n = name.trim(); if (n && n !== prop.name) patch({ name: n }) }
  return (
    <>
      <label className="bw-field">Name
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      </label>
      <label className="check"><input type="checkbox" checked={!!prop.solid} onChange={(e) => patch({ solid: e.target.checked })} /> Solid (blocks sight)</label>
      <label className="check"><input type="checkbox" checked={!!prop.locked} onChange={(e) => patch({ locked: e.target.checked })} /> Locked (no table drag)</label>
      <PropKindPane controller={controller} prop={prop} />
      <SelectionActions controller={controller} props={props} />
      <Fold id="prop.transform" title="Position, rotation, scale">
        <PropInspector controller={controller} />
      </Fold>
    </>
  )
}

export function PropsPane({ controller }: { controller: GameController }) {
  const props = useSelectedProps()
  const names = new Map<string, number>()
  for (const p of props) names.set(p.name, (names.get(p.name) ?? 0) + 1)
  const summary = [...names].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(', ')
  return (
    <>
      <p className="small bw-note">{summary}{names.size > 4 ? '…' : ''}</p>
      <p className="muted small bw-note">Drag, turn and scale them together on the board; Shift-click adds or drops one.</p>
      <SelectionActions controller={controller} props={props} />
      <Fold id="props.transform" title="Group transform">
        <PropInspector controller={controller} />
      </Fold>
    </>
  )
}
