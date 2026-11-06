// TODO(object-editing worker): transform editing for the selected token, prop, scene node or the scene itself.
import type { GameController } from '../controller'

export function ObjectPanel(_props: { controller: GameController }) {
  return (
    <div className="panel">
      <h3>Edit</h3>
      <p className="muted small">Select something on the table to edit its size, rotation and position.</p>
    </div>
  )
}
