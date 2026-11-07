/**
 * Saved groups: a selection of props, with the walls and doors inside its bounds, saved to the
 * Library's Saved shelf as a prefab and stamped elsewhere as one piece (one intent, one undo step);
 * encounters are saved creature groups. The Inspector's "Save as group" calls
 * `saveSelectionAsGroup`.
 *
 * Lights and kit tiles are not captured: the prefab model holds props and walls only.
 */
import type { Prefab, Prop, Wall } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PrefabId } from '@/core/ids'
import { useGame } from '@/state/store'
import { capturePrefab, snapRectToCells } from '@/table/build/prefab'
import { tableRuntime } from '@/table/tableState'
import type { GameController } from '../controller'
import { pushToast } from '../toasts'
import { useLibraryView } from './libraryView'

const FALLBACK_GRID: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }

/** "Group 3": the next free default name. */
export function nextGroupName(prefabs: Readonly<Record<string, Pick<Prefab, 'name'>>>): string {
  const names = new Set(Object.values(prefabs).map((p) => p.name))
  let n = Object.keys(prefabs).length + 1
  while (names.has(`Group ${n}`)) n++
  return `Group ${n}`
}

/**
 * The prefab for a selection: the selected props (only those), plus the walls of the same scene
 * with both ends inside the selection's bounds grown outwards to whole cells. Null when nothing is
 * selected. Pure.
 */
export function groupFromSelection(opts: {
  name: string
  props: readonly Prop[]
  walls: readonly Wall[]
  grid: GridSpec
  floorY?: number
  id?: PrefabId
  now?: number
}): Prefab | null {
  const props = opts.props
  if (!props.length) return null
  const scene = props[0]!.scene
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const p of props) {
    minX = Math.min(minX, p.position.x); maxX = Math.max(maxX, p.position.x)
    minZ = Math.min(minZ, p.position.z); maxZ = Math.max(maxZ, p.position.z)
  }
  const rect = snapRectToCells({ x: minX, z: minZ }, { x: maxX, z: maxZ }, opts.grid)
  return capturePrefab({
    name: opts.name,
    rect,
    cellSize: opts.grid.cellSize,
    props,
    walls: opts.walls.filter((w) => w.scene === scene),
    ...(opts.floorY !== undefined ? { floorY: opts.floorY } : {}),
    ...(opts.id ? { id: opts.id } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })
}

/**
 * Save the current prop selection as a group on the Saved shelf; resolves to the group's id, or
 * null when nothing is selected. One `prefab.upsert`. The Library switches to the Saved shelf so
 * the new card is in view.
 */
export async function saveSelectionAsGroup(controller: GameController, name?: string): Promise<string | null> {
  const s = useGame.getState()
  const props = s.propSelection.map((id) => s.props[id]).filter((p): p is Prop => !!p)
  if (!props.length) return null
  const scene = s.scenes[props[0]!.scene]
  const prefab = groupFromSelection({
    name: name?.trim() || nextGroupName(s.prefabs),
    props,
    walls: Object.values(s.walls),
    grid: scene?.grid ?? FALLBACK_GRID,
    floorY: tableRuntime.floorY,
  })
  if (!prefab) return null
  await controller.dispatch({ type: 'prefab.upsert', prefab })
  useLibraryView.getState().set({ shelf: 'saved', filter: 'all', query: '' })
  pushToast({ text: `Saved ${prefab.name} to the Library`, ttl: 2500 })
  return prefab.id
}
