/**
 * The Fog pop-out beside the Play tool rail (GM): Reveal / Hide brush, its size, Reveal all and
 * Hide all. It drives the build fog tools (`toggleBuildTool`, `useBuildUi.brush`), so the brush
 * paints with the build fog tools. Loaded the first time the GM opens it.
 */
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { toggleBuildTool, useBuildUi } from '@/table/build/buildState'
import { isFogEnabled } from '@/table/vision'
import { Icon } from '../icons'

export default function FogPopout({ controller, onClose }: { controller: GameController; onClose(): void }) {
  const tool = useBuildUi((s) => s.tool)
  const brush = useBuildUi((s) => s.brush)
  const set = useBuildUi((s) => s.set)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  if (!scene) return null
  const fogOn = isFogEnabled(scene)
  const dispatch = controller.dispatch
  return (
    <div className="t-fog-pop skin-paper" role="dialog" aria-label="Fog of war">
      <div className="paper-head">
        <Icon name="fog" size={18} className="paper-glyph" />
        <h2 className="host-title paper-title">Fog</h2>
        <button type="button" className="icon paper-close" aria-label="Close fog" onClick={onClose}><Icon name="close" /></button>
      </div>
      {!fogOn && (
        <p className="small t-fog-off">
          Fog is off in this scene.{' '}
          <button type="button" className="tiny" onClick={() => void dispatch({ type: 'scene.update', scene: scene.id, patch: { fogEnabled: true } })}>Turn on</button>
        </p>
      )}
      <div className="t-fog-modes" role="group" aria-label="Fog brush">
        <button type="button" className={`tiny${tool === 'fog-reveal' ? ' on primary' : ''}`} aria-pressed={tool === 'fog-reveal'}
          title="Paint cells explored for the players" onClick={() => toggleBuildTool('fog-reveal')}>Reveal</button>
        <button type="button" className={`tiny${tool === 'fog-hide' ? ' on primary' : ''}`} aria-pressed={tool === 'fog-hide'}
          title="Paint cells back into fog" onClick={() => toggleBuildTool('fog-hide')}>Hide</button>
      </div>
      <label className="t-fog-size"><span className="muted small">Brush {brush + 1}</span>
        <input type="range" min={0} max={5} step={1} value={brush} onChange={(e) => set({ brush: Number(e.target.value) })} aria-label="Brush size" />
      </label>
      <div className="t-fog-all">
        <button type="button" className="tiny" onClick={() => void dispatch({ type: 'fog.revealAll', scene: scene.id })} title="Reveal the whole map (Undo brings the fog back)">Reveal all</button>
        <button type="button" className="tiny" onClick={() => void dispatch({ type: 'fog.reset', scene: scene.id })} title="Cover the whole map again (Undo brings back what was explored)">Hide all</button>
      </div>
      <p className="muted small t-fog-hint">{tool === 'fog-reveal' || tool === 'fog-hide' ? 'Drag on the board to paint · Esc puts the brush away' : 'Pick Reveal or Hide, then drag on the board'}</p>
    </div>
  )
}
