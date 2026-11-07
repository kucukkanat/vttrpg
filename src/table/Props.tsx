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
  const list = useMemo(() => Object.values(props).filter((p) => p.scene === sceneId), [props, sceneId])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `standalone`
  const { singles, groups } = useMemo(() => groupProps(list, standalone, instancing), [list, key])
  return (
    <>
      {groups.map((g) => <PropBatch key={g.key} props={g.props} />)}
      {singles.map((p) => <MemoPropMesh key={p.id} prop={p} />)}
    </>
  )
}

