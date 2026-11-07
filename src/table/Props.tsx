/**
 * Every prop in a scene. Props that share a model draw as instanced batches (PropBatch.tsx); the
 * selected, edited and dragged ones draw standalone (PropMesh.tsx) so the gizmo and drags have a
 * real object to work on.
 */
import { useMemo } from 'react'
import type { PropId, SceneId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTableUi } from './tableState'
import { groupProps, idsKey, standaloneIds } from './propInstances'
import { PropBatch } from './PropBatch'
import { MemoPropMesh } from './PropMesh'
import { useTable } from './context'
import { heightVisible } from './kits/levels'
import { hasModel } from '@/core/propParts'

let instancing = true
/** Turns instanced prop rendering off (every prop standalone); for the benchmark's baseline. */
export function setPropInstancing(on: boolean): void {
  instancing = on
}

/** Batches render first: their footprint cleanup then runs before a standalone mesh republishes. */
export function Props({ sceneId }: { sceneId: SceneId }) {
  const props = useGame((s) => s.props)
  const selection = useGame((s) => s.selection)
  const propSelection = useGame((s) => s.propSelection)
  const previewId = useTableUi((s) => (s.editPreview?.target.kind === 'prop' ? (s.editPreview.target.id as PropId) : null))
  const standalone = useMemo(() => standaloneIds({ selection, propSelection, previewId }), [selection, propSelection, previewId])
  const key = idsKey(standalone)
  // The kit cutaway hides props that start above its level.
  const { kits, floorY, grid } = useTable()
  const cut = kits?.cut ?? Infinity
  const list = useMemo(
    // Invisible walls, doors and lights have no model: PropParts draws their gizmos.
    () => Object.values(props).filter((p) => p.scene === sceneId && hasModel(p) && heightVisible(p.position.y, cut, floorY, grid)),
    [props, sceneId, cut, floorY, grid],
  )
  // Door models swing on their hinge, so they are drawn standalone.
  const doorKey = useMemo(() => list.filter((p) => p.door && !p.wall).map((p) => p.id).join('|'), [list])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `standalone`, `doorKey` for the doors
  const { singles, groups } = useMemo(() => groupProps(list, doorKey ? new Set([...standalone, ...(doorKey.split('|') as PropId[])]) : standalone, instancing), [list, key, doorKey])
  return (
    <>
      {groups.map((g) => <PropBatch key={g.key} props={g.props} />)}
      {singles.map((p) => <MemoPropMesh key={p.id} prop={p} />)}
    </>
  )
}

