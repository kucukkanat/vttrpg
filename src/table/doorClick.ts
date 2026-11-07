/**
 * Clicking a door prop opens or closes it: play, not editing, so it answers through the prop
 * click registry (propClick.ts) and works whatever the GM's Edit toggle says.
 *
 * - GM: a click works any door, locked or not. Locking is in the Inspector (`toggleLockIntent`).
 * - Players: a click works an unlocked door where the scene allows it (`playersOpenDoors`) while
 *   one side of it is in sight; other doors do not answer them.
 *
 * `useDoorClicks` registers the handler while a table is mounted (it needs the table's intents).
 */
import { useEffect } from 'react'
import type { Prop } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { Intent } from '@/core/intents'
import { propDoorGap, type Segment } from '@/core/propParts'
import { useGame } from '@/state/store'
import { cellKey, worldToCell } from './grid'
import { modelBoundsOf } from './modelBounds'
import { registerPropClick } from './propClick'
import { useTableUi } from './tableState'

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

/**
 * A player may work this door now: the scene allows it, it is unlocked, and a side is in sight
 * (`visible` null: fog is off, everything is in sight).
 */
export function playerCanWork(prop: Prop, scene: { playersOpenDoors?: boolean; grid: GridSpec } | undefined, visible: ReadonlySet<string> | null): boolean {
  if (!prop.door || prop.door.locked || !scene?.playersOpenDoors) return false
  if (!visible) return true
  const seg = propDoorGap(prop, modelBoundsOf(prop), scene.grid.cellSize)
  return !seg || doorSides(seg, scene.grid).some((k) => visible.has(k))
}

/** Whether a click on `prop` works it as a door for this viewer. */
export function doorAnswers(prop: Prop, gm: boolean): boolean {
  if (!prop.door) return false
  if (gm) return true
  return playerCanWork(prop, useGame.getState().scenes[prop.scene], useTableUi.getState().visible)
}

/** Registers the door click handler while the table is mounted (not for a table display). */
export function useDoorClicks(onIntent: (intent: Intent) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return registerPropClick({
      wants: (prop, gm) => doorAnswers(prop, gm),
      click: (prop, gm) => {
        if (!doorAnswers(prop, gm)) return
        const i = toggleDoorIntent(prop)
        if (i) onIntent(i)
      },
    })
  }, [onIntent, enabled])
}
