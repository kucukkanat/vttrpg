/**
 * The scene card (GM): the scene title in the top rail opens it. The scene switcher (the list with
 * Live, Switch, Preview, rename and remove, and + Add) over the live scene's settings: name and
 * map, grid, light and weather, starting fog, table display and credits (ScenePane). Players'
 * scene title opens the plain Scenes card instead.
 */
import type { GameController } from '../controller'
import { ScenesPanel } from './ScenesPanel'
import { ScenePane } from '../build/panes/ScenePane'

export function SceneSwitcher({ controller }: { controller: GameController }) {
  return (
    <div className="scene-card">
      <ScenesPanel controller={controller} />
      <section className="panel scene-card-settings" aria-label="Scene settings">
        <h3 className="scene-card-head">This scene</h3>
        <ScenePane controller={controller} />
      </section>
    </div>
  )
}
