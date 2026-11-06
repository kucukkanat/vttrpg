import { useEffect, useState, type ChangeEvent } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newId, type SceneId } from '@/core/ids'
import type { LibraryEntry } from '@/assets'
import type { CameraMode, Scene } from '@/core/doc'
import { createImageScene, importSceneFile, readImageSize, suggestColumns, type ImageSize, type ImportHooks } from '@/import'
import { imageSceneLayout, pixelsPerCell, useTableUi } from '@/table'
import { fogStatus, isFogEnabled } from '@/table/vision'
import { libraryModels, libraryRef, loadLibraryIndex, titleCase } from '../library'
import { pushToast } from '../toasts'
import './ScenesPanel.css'

/** A map image waiting for its grid size. */
interface MapImageDraft {
  file: File
  url: string
  size: ImageSize
  columns: number
  name: string
}

/** A running import that needs the user to pick the background image (Foundry exports). */
interface ImagePrompt {
  info: Parameters<NonNullable<ImportHooks['pickImage']>>[0]
  resolve(file: File | null): void
}

type Status = { tone: 'info' | 'error'; text: string }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const CAMERA_HINT: Record<CameraMode, string> = {
  orbit: 'Camera: free orbit · tap to follow a token',
  token: 'Camera: follows a token · tap for free orbit',
}

/**
 * Scenes: the list (Live badge on the active one, Switch on the others), ways to add a scene, and
 * the active scene's weather, ambience, darkness and fog. Adding stages the scene without
 * switching; the GM switches when ready (a toast offers it). The first scene of a game goes live
 * at once, since there is nothing to interrupt.
 */
export function ScenesPanel({ controller }: { controller: GameController }) {
  const scenes = useGame((s) => s.scenes)
  const meta = useGame((s) => s.meta)
  const activeFog = useGame((s) => (s.meta?.activeScene ? s.fog[s.meta.activeScene] : undefined))
  const sceneErrors = useTableUi((s) => s.sceneErrors)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [mapImage, setMapImage] = useState<MapImageDraft | null>(null)
  const [imagePrompt, setImagePrompt] = useState<ImagePrompt | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const isGm = controller.connection.isGm
  const cellSize = controller.rules?.pack.manifest.grid.cellSize ?? 1.5
  useEffect(() => { void loadLibraryIndex().then((l) => setLibrary(libraryModels(l, 'scene'))) }, [])
  // The preview thumbnail is an object URL; drop it with the draft.
  useEffect(() => () => { if (mapImage) URL.revokeObjectURL(mapImage.url) }, [mapImage])

  const switchTo = (id: SceneId) => controller.dispatch({ type: 'scene.activate', scene: id })
  /** A new scene is staged, not shown: say so and offer the switch. With no live scene yet it just goes live. */
  const staged = async (scene: Scene) => {
    if (!useGame.getState().meta?.activeScene) { await switchTo(scene.id); return }
    pushToast({ text: `Added ${scene.name}`, action: { label: 'Switch', run: () => void switchTo(scene.id) } })
  }

  const addFromLibrary = async (e: LibraryEntry) => {
    const id = newId<'SceneId'>()
    const type = controller.rules?.pack.manifest.grid.type ?? 'square'
    const scene: Scene = {
      id, name: titleCase(e.name), model: libraryRef(e),
      grid: { type, cellSize, origin: { x: 0, y: 0, z: 0 } },
      cameraMode: 'orbit', darkness: 0.8,
    }
    await controller.dispatch({ type: 'scene.add', scene })
    await staged(scene)
  }
  const addFromFile = async (file: File) => {
    const ref = await controller.assets.importFile(file)
    const id = newId<'SceneId'>()
    const scene: Scene = {
      id, name: titleCase(file.name), model: ref, grid: { type: 'square', cellSize, origin: { x: 0, y: 0, z: 0 } }, cameraMode: 'orbit', darkness: 0.8,
    }
    await controller.dispatch({ type: 'scene.add', scene })
    await staged(scene)
  }

  // --- map images -----------------------------------------------------------------------------
  const pickMapImage = async (file: File) => {
    setStatus(null)
    try {
      const size = await readImageSize(file)
      setMapImage({ file, url: URL.createObjectURL(file), size, columns: suggestColumns(size.width), name: titleCase(file.name) })
    } catch (e) {
      setStatus({ tone: 'error', text: `Could not read ${file.name}: ${errText(e)}` })
    }
  }
  const confirmMapImage = async () => {
    if (!mapImage) return
    setBusy(true)
    try {
      const scene = await createImageScene(mapImage.file, controller, { columns: mapImage.columns, cellSize, name: mapImage.name.trim() || 'Map', activate: false }, mapImage.size)
      setMapImage(null)
      await staged(scene)
    } catch (e) {
      setStatus({ tone: 'error', text: `Could not add the map: ${errText(e)}` })
    } finally {
      setBusy(false)
    }
  }

  // --- map exports ----------------------------------------------------------------------------
  const importMap = async (file: File) => {
    setStatus(null)
    setBusy(true)
    try {
      const result = await importSceneFile(file, controller, {
        cellSize,
        activate: false,
        pickImage: (info) => new Promise<File | null>((resolve) => setImagePrompt({ info, resolve })),
      })
      if (result) {
        const notes = result.notes.length ? `: ${result.notes.join('; ')}` : ''
        setStatus({ tone: 'info', text: `Imported ${result.scene.name}${notes}` })
        await staged(result.scene)
      }
    } catch (e) {
      setStatus({ tone: 'error', text: `Import failed: ${errText(e)}` })
    } finally {
      setImagePrompt(null)
      setBusy(false)
    }
  }
  const onFile = (handler: (f: File) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (f) handler(f)
  }

  const active = meta?.activeScene ? scenes[meta.activeScene] : undefined
  const update = (patch: Partial<Scene>) => active && void controller.dispatch({ type: 'scene.update', scene: active.id, patch })
  const toggleCamera = (id: SceneId) => {
    const s = scenes[id]
    void controller.dispatch({ type: 'scene.update', scene: id, patch: { cameraMode: s.cameraMode === 'orbit' ? 'token' : 'orbit' } })
  }
  const remove = (id: SceneId) => void controller.dispatch({ type: 'scene.remove', scene: id })

  // --- fog ------------------------------------------------------------------------------------
  const fogOn = active ? isFogEnabled(active) : false
  const explored = (activeFog?.revealed.length ?? 0) > 0 || !!activeFog?.revealAll
  const revealAll = () => active && void controller.dispatch({ type: 'fog.revealAll', scene: active.id })
  const hideAll = () => active && void controller.dispatch({ type: 'fog.reset', scene: active.id })
  /** Back to the starting state: fog on and nothing explored. */
  const resetFog = async () => {
    if (!active) return
    if (!fogOn) await controller.dispatch({ type: 'scene.update', scene: active.id, patch: { fogEnabled: true } })
    if (explored) await controller.dispatch({ type: 'fog.reset', scene: active.id })
  }

  return (
    <div className="panel">
      <h3>Scenes</h3>
      <ul className="list scenes-list">
        {Object.values(scenes).map((s) => {
          const live = s.id === meta?.activeScene
          const err = sceneErrors[s.id]
          return (
            <li key={s.id} className={live ? 'selected' : ''}>
              <span className="scene-name">
                {err && <span className="scene-warn" role="img" aria-label="Failed to load" title={`Couldn't load ${s.name}: ${err}`}>⚠</span>}
                <span className="scene-title">{s.name}</span>
                {s.image && !s.model ? <span className="muted small"> · map</span> : null}
              </span>
              {live
                ? <span className="scene-live" title="The scene everyone is looking at">Live</span>
                : isGm && <button className="scene-switch" onClick={() => void switchTo(s.id)}>Switch</button>}
              {isGm && (
                <button className="icon scene-camera" title={CAMERA_HINT[s.cameraMode]} aria-label={CAMERA_HINT[s.cameraMode]} onClick={() => toggleCamera(s.id)}>
                  <CameraIcon mode={s.cameraMode} />
                </button>
              )}
              {isGm && (
                <button className="icon scene-remove" disabled={live} onClick={() => remove(s.id)}
                  title={live ? 'Switch to another scene before removing the live one' : `Remove ${s.name}`} aria-label={`Remove ${s.name}`}>×</button>
              )}
            </li>
          )
        })}
      </ul>
      {isGm && (
        <div className="row">
          {library.map((e) => <button key={e.sha256} className="tiny" onClick={() => void addFromLibrary(e)}>+ {titleCase(e.name)}</button>)}
          <label className="tiny-file">
            + GLB file
            <input type="file" accept=".glb" hidden disabled={busy} onChange={onFile((f) => void addFromFile(f))} />
          </label>
          <label className="tiny-file">
            + Map image
            <input type="file" accept="image/*" hidden disabled={busy} onChange={onFile((f) => void pickMapImage(f))} />
          </label>
          <label className="tiny-file" title="Universal VTT (.dd2vtt, .uvtt) or a Foundry scene export (.json)">
            + Import map
            <input type="file" accept=".dd2vtt,.uvtt,.json,application/json" hidden disabled={busy} onChange={onFile((f) => void importMap(f))} />
          </label>
        </div>
      )}
      {isGm && mapImage && (
        <MapImageForm draft={mapImage} cellSize={cellSize} busy={busy} onChange={setMapImage} onConfirm={() => void confirmMapImage()} onCancel={() => setMapImage(null)} />
      )}
      {isGm && imagePrompt && (
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="small">
            Pick the background image for <b>{imagePrompt.info.name}</b>
            {imagePrompt.info.imagePath ? <span className="muted"> ({imagePrompt.info.imagePath.split('/').pop()})</span> : null}
            {imagePrompt.info.pixelSize ? <span className="muted"> · {imagePrompt.info.pixelSize.width} × {imagePrompt.info.pixelSize.height} px</span> : null}
          </span>
          <div className="row" style={{ marginTop: 0 }}>
            <label className="tiny-file">
              Choose image
              <input type="file" accept="image/*" hidden onChange={onFile((f) => imagePrompt.resolve(f))} />
            </label>
            <button className="tiny" onClick={() => imagePrompt.resolve(null)}>Cancel</button>
          </div>
        </div>
      )}
      {status && <p className={`small ${status.tone === 'error' ? 'error' : 'muted'}`} style={{ margin: '6px 0 0' }}>{status.text}</p>}
      {isGm && active && (
        <>
          <div className="grid2">
            <label>Weather
              <select value={active.weather ?? 'none'} onChange={(e) => update({ weather: e.target.value as Scene['weather'] })}>
                {['none', 'rain', 'snow', 'fog', 'embers'].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label>Ambience
              <select value={active.ambientPreset ?? 'none'} onChange={(e) => update({ ambientPreset: e.target.value as Scene['ambientPreset'] })}>
                {['none', 'wind', 'fire', 'rain', 'cave', 'tavern', 'forest'].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label>Darkness <span className="muted">{Math.round(active.darkness * 100)}%</span>
              <input type="range" min={0} max={1} step={0.05} value={active.darkness} onChange={(e) => update({ darkness: Number(e.target.value) })} />
            </label>
          </div>
          <div className="fog-block">
            <div className="fog-head">
              <label className="check">
                <input type="checkbox" checked={fogOn} onChange={(e) => update({ fogEnabled: e.target.checked })} />
                Fog of war
              </label>
              <span className="muted small fog-status">{fogStatus(active, activeFog)}</span>
            </div>
            <div className="row">
              <button className="tiny" disabled={!fogOn || !!activeFog?.revealAll} title="Players see the whole map" onClick={revealAll}>Reveal all</button>
              <button className="tiny" disabled={!fogOn || !explored} title="Forget what has been explored; tokens reveal what they see from here" onClick={hideAll}>Hide all</button>
              <button className="tiny" disabled={fogOn && !explored} title="Fog on with nothing explored" onClick={() => void resetFog()}>Reset</button>
            </div>
          </div>
        </>
      )}
      {isGm && Object.keys(scenes).length === 0 && (
        <p className="muted small">
          Add a scene from the library, a GLB following the Blender convention, a map image, or import a Universal VTT (.dd2vtt / .uvtt)
          or Foundry scene export. Owlbear Rodeo has no scene export: save the map there as an image and use + Map image.
        </p>
      )}
    </div>
  )
}

/** Orbit: a ring around a body. Follow: an eye. Both inherit the button colour. */
function CameraIcon({ mode }: { mode: CameraMode }) {
  if (mode === 'orbit') {
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle cx="10" cy="10" r="3" fill="currentColor" />
        <ellipse cx="10" cy="10" rx="8.5" ry="3.5" fill="none" stroke="currentColor" strokeWidth="1.4" transform="rotate(-25 10 10)" />
        <circle cx="16.8" cy="5.6" r="1.7" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M1.5 10s3-5.5 8.5-5.5S18.5 10 18.5 10s-3 5.5-8.5 5.5S1.5 10 1.5 10z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="2.6" fill="currentColor" />
    </svg>
  )
}

/**
 * Grid size for a map image: columns across (rows follow from the aspect ratio), cell size from the
 * pack, with the grid drawn over a thumbnail so misaligned counts are obvious before the scene exists.
 */
function MapImageForm({ draft, cellSize, busy, onChange, onConfirm, onCancel }: {
  draft: MapImageDraft
  cellSize: number
  busy: boolean
  onChange(d: MapImageDraft): void
  onConfirm(): void
  onCancel(): void
}) {
  const { width, height } = draft.size
  const layout = imageSceneLayout(draft.columns, width, height, cellSize)
  const px = pixelsPerCell(width, layout.widthCells)
  const rows = Math.round(layout.heightCells * 10) / 10
  const lines: number[] = []
  for (let i = 1; i < layout.widthCells; i++) lines.push(i * px)
  const hLines: number[] = []
  for (let z = px; z < height - 0.5; z += px) hLines.push(z)
  // Full panel width, but never taller than ~200px: the aspect ratio is fixed, so capping the width caps the height.
  const maxH = 200
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: (maxH * width) / height, aspectRatio: `${width} / ${height}`, borderRadius: 6, overflow: 'hidden', background: '#111', margin: '0 auto' }}>
        <img src={draft.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {lines.map((x) => <line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke="#ffe9a8" strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />)}
          {hLines.map((z) => <line key={`h${z}`} x1={0} y1={z} x2={width} y2={z} stroke="#ffe9a8" strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />)}
        </svg>
      </div>
      <span className="muted small">{width} × {height} px · {Math.round(px)} px per cell · {layout.widthCells} × {rows} cells of {cellSize} m</span>
      <div className="grid2">
        <label>Name<input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} disabled={busy} /></label>
        <label>Columns
          <input type="number" inputMode="numeric" min={1} max={400} step={1} value={draft.columns}
            onChange={(e) => onChange({ ...draft, columns: Math.max(1, Math.min(400, Math.round(Number(e.target.value) || 1))) })} disabled={busy} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 0 }}>
        <button className="primary" disabled={busy} onClick={onConfirm}>{busy ? 'Adding…' : 'Add scene'}</button>
        <button disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
