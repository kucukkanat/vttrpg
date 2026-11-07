/**
 * The scene switcher (Play, GM): the scene title in the top rail opens this card. The scenes, the
 * live one marked, Go live on the others. Adding scenes and their settings are Build's.
 */
import { useGame } from '@/state/store'
import type { SceneId } from '@/core/ids'
import type { GameController } from '../controller'
import { useTableLayout } from '../shell/tableLayout'
import { setTableMode } from '../shell/TableChrome'

export function SceneSwitcher({ controller }: { controller: GameController }) {
  const scenes = useGame((s) => s.scenes)
  const active = useGame((s) => s.meta?.activeScene ?? null)
  const list = Object.values(scenes)
  const goLive = async (id: SceneId) => {
    await controller.dispatch({ type: 'scene.activate', scene: id })
    useTableLayout.getState().set({ card: null })
  }
  return (
    <div className="panel scene-switcher">
      {list.length === 0 && <p className="muted small">No scenes yet. Add one in Build.</p>}
      <ul className="list">
        {list.map((s) => {
          const live = s.id === active
          return (
            <li key={s.id} className={live ? 'selected' : ''} style={{ cursor: 'default' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.name}{s.image && !s.model ? <span className="muted small"> · map</span> : null}
              </span>
              {live
                ? <span className="scene-live muted small" title="The scene everyone is looking at">Live</span>
                : <button type="button" className="tiny primary" onClick={() => void goLive(s.id)} title={`Show ${s.name} to everyone`}>Go live</button>}
            </li>
          )
        })}
      </ul>
      <button type="button" className="wide" onClick={() => { useTableLayout.getState().set({ card: null }); setTableMode('build') }}
        title="Add scenes and change their settings in Build">Add or edit scenes in Build</button>
    </div>
  )
}
