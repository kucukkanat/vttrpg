import { useEffect, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newId, type SceneId } from '@/core/ids'
import type { LibraryEntry } from '@/assets'
import { libraryRef, loadLibraryIndex } from '../library'

export function ScenesPanel({ controller }: { controller: GameController }) {
  const scenes = useGame((s) => s.scenes)
  const meta = useGame((s) => s.meta)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const isGm = controller.connection.isGm
  useEffect(() => { void loadLibraryIndex().then((l) => setLibrary(l.filter((e) => e.kind === 'glb'))) }, [])

  const addFromLibrary = async (e: LibraryEntry) => {
    const id = newId<'SceneId'>()
    const cellSize = controller.rules?.pack.manifest.grid.cellSize ?? 1.5
    const type = controller.rules?.pack.manifest.grid.type ?? 'square'
    await controller.dispatch({
      type: 'scene.add',
      scene: {
        id, name: e.name.replace(/\.glb$/i, ''), model: libraryRef(e),
        grid: { type, cellSize, origin: { x: 0, y: 0, z: 0 } },
        cameraMode: 'orbit', darkness: 0.8,
      },
    })
    await controller.dispatch({ type: 'scene.activate', scene: id })
  }
  const addFromFile = async (file: File) => {
    const ref = await controller.assets.importFile(file)
    const id = newId<'SceneId'>()
    const cellSize = controller.rules?.pack.manifest.grid.cellSize ?? 1.5
    await controller.dispatch({
      type: 'scene.add',
      scene: { id, name: file.name.replace(/\.glb$/i, ''), model: ref, grid: { type: 'square', cellSize, origin: { x: 0, y: 0, z: 0 } }, cameraMode: 'orbit', darkness: 0.8 },
    })
    await controller.dispatch({ type: 'scene.activate', scene: id })
  }
  const toggleCamera = (id: SceneId) => {
    const s = scenes[id]
    void controller.dispatch({ type: 'scene.update', scene: id, patch: { cameraMode: s.cameraMode === 'orbit' ? 'token' : 'orbit' } })
  }

  return (
    <div className="panel">
      <h3>Scenes</h3>
      <ul className="list">
        {Object.values(scenes).map((s) => (
          <li key={s.id} className={s.id === meta?.activeScene ? 'selected' : ''} onClick={() => isGm && void controller.dispatch({ type: 'scene.activate', scene: s.id })}>
            <span style={{ flex: 1 }}>{s.name}</span>
            {isGm && <button className="tiny" title="Toggle camera mode" onClick={(e) => { e.stopPropagation(); toggleCamera(s.id) }}>{s.cameraMode}</button>}
          </li>
        ))}
      </ul>
      {isGm && (
        <div className="row">
          {library.map((e) => <button key={e.sha256} className="tiny" onClick={() => void addFromLibrary(e)}>+ {e.name.replace(/\.glb$/i, '')}</button>)}
          <label className="tiny-file">
            + GLB file
            <input type="file" accept=".glb" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFromFile(f) }} />
          </label>
        </div>
      )}
      {isGm && Object.keys(scenes).length === 0 && <p className="muted small">Add a scene from the library or a GLB following the Blender convention.</p>}
    </div>
  )
}
