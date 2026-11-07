/**
 * Clicking a door prop opens or closes it; that is play, not editing, so it has its own path
 * through the prop pointer handlers and works whether or not props can be edited.
 *
 * - Players: a click works an unlocked door where the scene allows it (`playersOpenDoors`) while
 *   one side of it is in sight. They never select a door.
 * - GM, props not editable: a click opens or closes, a right-click locks or unlocks.
 * - GM, props editable: the door is a prop like any other (select, drag, the prop menu); the
 *   Inspector opens and locks it.
 *
 * `doorGate.propsEditable` says whether the GM is editing props. It follows Build and edit mode
 * here; the one-mode shell points it at its Edit toggle.
 */
import type { Prop } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { Intent } from '@/core/intents'
import { propSegment, type Segment } from '@/core/propParts'
import { cellKey, worldToCell } from './grid'
import { modelBoundsOf } from './modelBounds'
import { useTableUi } from './tableState'

export const doorGate: { propsEditable: () => boolean } = {
  propsEditable: () => {
    const ui = useTableUi.getState()
    return ui.buildMode || ui.editMode
  },
}

/** Whether a click on a door prop works the door (true) or treats it as a prop to edit (false). */
export function doorClickWorks(prop: Pick<Prop, 'door'>, gm: boolean): boolean {
  return !!prop.door && (!gm || !doorGate.propsEditable())
}

export function toggleDoorIntent(prop: Prop): Intent | null {
  return prop.door ? { type: 'prop.door', prop: prop.id, open: !prop.door.open } : null
}

export function toggleLockIntent(prop: Prop): Intent | null {
  if (!prop.door) return null
  const { locked, ...rest } = prop.door
  const door = locked ? rest : { ...rest, locked: true }
  return { type: 'props.update', updates: [{ id: prop.id, patch: { door } }] }
}

/** The cells either side of a door's middle, for "a side is in sight". */
export function doorSides(seg: Segment, grid: GridSpec): string[] {
  const mx = (seg.a.x + seg.b.x) / 2, mz = (seg.a.z + seg.b.z) / 2
  const dx = seg.b.x - seg.a.x, dz = seg.b.z - seg.a.z
  const len = Math.hypot(dx, dz) || 1
  const off = grid.cellSize * 0.3
  const nx = (-dz / len) * off, nz = (dx / len) * off
  return [cellKey(worldToCell(grid, mx + nx, mz + nz)), cellKey(worldToCell(grid, mx - nx, mz - nz))]
}

/** A player may work this door now: the scene allows it, it is unlocked, and a side is in sight. */
export function playerCanWork(prop: Prop, scene: { playersOpenDoors?: boolean }, grid: GridSpec): boolean {
  if (!prop.door || prop.door.locked || !scene.playersOpenDoors) return false
  const visible = useTableUi.getState().visible
  if (!visible) return true
  const seg = propSegment(prop, modelBoundsOf(prop), grid.cellSize)
  return !seg || doorSides(seg, grid).some((k) => visible.has(k))
}
