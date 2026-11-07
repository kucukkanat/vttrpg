/**
 * The Build Inspector: one context at a time (inspectorContext.ts). The selection's editor, else
 * the active tool's options, else the live scene.
 */
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { Selected } from '../panels/ObjectPanel'
import { contextTitle, inspectorContext, type InspectorContext } from './inspectorContext'
import { Fold } from './Fold'
import { PropPane, PropsPane } from './panes/PropPane'
import { TokenEditor } from './panes/TokenPane'
import { ScenePane } from './panes/ScenePane'
import { PaintOptions } from './panes/PaintOptions'
import { FogOptions, LightOptions, WallsOptions } from './panes/ToolOptions'

export function useInspectorContext(): InspectorContext {
  const selection = useGame((s) => s.selection)
  const propCount = useGame((s) => s.propSelection.length)
  const selectedToken = useGame((s) => s.selectedToken)
  const tool = useBuildUi((s) => s.tool)
  return inspectorContext({ selection, propCount, selectedToken, tool })
}

/** The Inspector's body for the current context (the dock and the phone sheet both use it). */
export function InspectorBody({ controller, context }: { controller: GameController; context: InspectorContext }) {
  const token = useGame((s) => (s.selectedToken ? s.tokens[s.selectedToken] : undefined))
  const selection = useGame((s) => s.selection)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  switch (context.kind) {
    case 'prop': return <PropPane controller={controller} />
    case 'props': return <PropsPane controller={controller} />
    case 'token': return token ? <TokenEditor key={token.id} controller={controller} token={token} Section={Fold} /> : null
    case 'node': return selection && scene ? <Selected controller={controller} selection={selection} scene={scene} sceneId={scene.id} onDeselect={() => useGame.getState().setSelection(null)} /> : null
    case 'tool':
      switch (context.tool) {
        case 'paint': return <PaintOptions />
        case 'walls': return <WallsOptions controller={controller} />
        case 'light': return <LightOptions controller={controller} />
        case 'fog': return <FogOptions controller={controller} />
      }
      return null
    case 'scene': return <ScenePane controller={controller} />
  }
}

/** The heading line: what the Inspector is showing, and whose name. */
export function useInspectorHeading(context: InspectorContext): { kind: string; name: string | null } {
  const name = useGame((s) => {
    if (context.kind === 'prop') { const id = s.propSelection[s.propSelection.length - 1]; return id ? s.props[id]?.name ?? null : null }
    if (context.kind === 'token') return s.selectedToken ? s.tokens[s.selectedToken]?.name ?? null : null
    if (context.kind === 'node') return s.selection?.kind === 'node' ? s.selection.id : null
    if (context.kind === 'scene') return s.meta?.activeScene ? s.scenes[s.meta.activeScene]?.name ?? null : null
    return null
  })
  return { kind: contextTitle(context), name }
}
