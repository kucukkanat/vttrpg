/**
 * The Inspector with nothing selected and no tool out: the live scene. Folded sections for the
 * name and map, the grid (and the model's fit), light and weather, the starting fog, the table
 * display, and a link to the credits card.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../../controller'
import type { Scene } from '@/core/doc'
import type { GridType } from '@/core/geometry'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { tableRuntime, useTableUi } from '@/table/tableState'
import { displayLinkFromInvite, makeView, PULL_CLEAR_MS } from '@/table/view'
import { fogStatus, isFogEnabled } from '@/table/vision'
import { copyText } from '../../invite'
import { pushToast } from '../../toasts'
import { SceneEditor } from '../../panels/ObjectPanel'
import { requestOpenPanel } from '../../shell/useShortcuts'
import { Fold } from '../Fold'

const WEATHER = ['none', 'rain', 'snow', 'fog', 'embers'] as const
const AMBIENCE = ['none', 'wind', 'fire', 'rain', 'cave', 'tavern', 'forest'] as const
const GRIDS: { id: GridType; label: string }[] = [{ id: 'square', label: 'Squares' }, { id: 'hex', label: 'Hexes' }, { id: 'none', label: 'None' }]

export function ScenePane({ controller }: { controller: GameController }) {
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const fog = useGame((s) => (s.meta?.activeScene ? s.fog[s.meta.activeScene] : undefined))
  if (!scene) return <p className="muted small">No live scene: add one from the scene menu above.</p>
  const update = (patch: Partial<Scene>) => void controller.dispatch({ type: 'scene.update', scene: scene.id, patch })
  const fogOn = isFogEnabled(scene)
  const mood = [scene.weather && scene.weather !== 'none' ? scene.weather : '', scene.ambientPreset && scene.ambientPreset !== 'none' ? scene.ambientPreset : '', `${Math.round(scene.darkness * 100)}% dark`].filter(Boolean).join(' · ')
  return (
    <>
      <Fold id="scene.name" title="Name and map" summary={scene.image && !scene.model ? 'map image' : 'model'}>
        <SceneName scene={scene} onRename={(name) => update({ name })} />
        <p className="muted small bw-note">{scene.image
          ? `Map image, ${scene.image.widthCells} × ${Math.round(scene.image.heightCells * 10) / 10} cells${scene.walls?.length ? ` · ${scene.walls.length} imported walls` : ''}`
          : `Model${scene.model?.name ? `: ${scene.model.name}` : ''}`}</p>
      </Fold>
      <Fold id="scene.grid" title="Grid" summary={`${GRIDS.find((g) => g.id === scene.grid.type)?.label ?? scene.grid.type} · ${scene.grid.cellSize} m`}>
        <GridFields scene={scene} onChange={(grid) => update({ grid })} />
        {scene.model && (
          <Fold id="scene.fit" title="Fit the model">
            <SceneEditor controller={controller} sceneId={scene.id} scene={scene} cell={scene.grid.cellSize} editable />
          </Fold>
        )}
      </Fold>
      <Fold id="scene.mood" title="Light and weather" summary={mood}>
        <label className="bw-range"><span>Darkness <span className="muted">{Math.round(scene.darkness * 100)}%</span></span>
          <input type="range" min={0} max={1} step={0.05} value={scene.darkness} onChange={(e) => update({ darkness: Number(e.target.value) })} aria-label="Darkness" />
        </label>
        <div className="grid2">
          <label>Weather
            <select value={scene.weather ?? 'none'} onChange={(e) => update({ weather: e.target.value as Scene['weather'] })}>
              {WEATHER.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label>Ambience
            <select value={scene.ambientPreset ?? 'none'} onChange={(e) => update({ ambientPreset: e.target.value as Scene['ambientPreset'] })}>
              {AMBIENCE.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
        </div>
      </Fold>
      <Fold id="scene.fog" title="Starting fog" summary={fogOn ? 'fog on' : 'fog off'}>
        <label className="check">
          <input type="checkbox" checked={fogOn} onChange={(e) => update({ fogEnabled: e.target.checked })} />
          Fog of war
        </label>
        <p className="muted small bw-note">{fogStatus(scene, fog)}. The Fog tool paints, reveals or hides it all.</p>
      </Fold>
      <Fold id="scene.display" title="Table display">
        <DisplayBlock controller={controller} />
      </Fold>
      <button type="button" className="tiny bw-link" onClick={() => requestOpenPanel('credits')} title="Models in this scene that need attribution">Credits ›</button>
    </>
  )
}

function SceneName({ scene, onRename }: { scene: Scene; onRename(name: string): void }) {
  const [name, setName] = useState(scene.name)
  useEffect(() => setName(scene.name), [scene.id, scene.name])
  const commit = () => { const n = name.trim(); if (n && n !== scene.name) onRename(n); else setName(scene.name) }
  return (
    <label className="bw-field">Name
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

function GridFields({ scene, onChange }: { scene: Scene; onChange(grid: Scene['grid']): void }) {
  const g = scene.grid
  const origin = (k: 'x' | 'z') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (Number.isFinite(v)) onChange({ ...g, origin: { ...g.origin, [k]: v } })
  }
  return (
    <>
      <label className="bw-field">Cells
        <select value={g.type} onChange={(e) => onChange({ ...g, type: e.target.value as GridType })}>
          {GRIDS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <div className="grid2">
        <label>Offset X (m)<input type="number" step={0.05} value={g.origin.x} onChange={origin('x')} /></label>
        <label>Offset Z (m)<input type="number" step={0.05} value={g.origin.z} onChange={origin('z')} /></label>
      </div>
      <p className="muted small bw-note">Cells are {g.cellSize} m (the rules pack's size). Nudge the offset until the grid sits on the map's lines.</p>
    </>
  )
}

/** A chrome-free table view for a TV or a second screen; sharing the GM's view; pulling everyone to it. */
function DisplayBlock({ controller }: { controller: GameController }) {
  const share = useBuildUi((s) => s.shareView)
  const set = useBuildUi((s) => s.set)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const previewing = useTableUi((s) => s.previewScene !== null)
  const [mode, setMode] = useState<'follow' | 'overview'>('follow')
  const link = useMemo(() => {
    try { return displayLinkFromInvite(controller.connection.inviteLink(), mode) } catch { return null }
  }, [controller, mode])
  const open = () => {
    if (!link) return
    window.open(link, 'vttrpg-display', 'noopener')
    if (mode === 'follow' && !share) set({ shareView: true })
  }
  const copy = async () => {
    if (!link) return
    const ok = await copyText(link)
    pushToast({ text: ok ? 'Display link copied' : 'Could not copy the link', ttl: 2500 })
    if (ok && mode === 'follow' && !share) set({ shareView: true })
  }
  const pull = () => {
    const pos = tableRuntime.cameraPosition, target = tableRuntime.cameraTarget
    if (!sceneId || !pos || !target || previewing) return
    controller.presence({ pull: makeView(sceneId, pos, target) })
    setTimeout(() => controller.presence({ pull: undefined }), PULL_CLEAR_MS)
    pushToast({ text: 'Everyone is looking where you are', ttl: 2500 })
  }
  return (
    <>
      <p className="muted small bw-note">A table view with no panels, for a TV or a second screen: it sees what the players see, never your secrets.</p>
      <div className="row bw-row">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'follow' | 'overview')} aria-label="Display camera">
          <option value="follow">Follows my view</option>
          <option value="overview">Whole map</option>
        </select>
        <button type="button" className="tiny" disabled={!link} onClick={open}>Open display</button>
        <button type="button" className="tiny" disabled={!link} onClick={() => void copy()}>Copy link</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={share} onChange={(e) => set({ shareView: e.target.checked })} />
        Share my view with displays
      </label>
      <button type="button" className="tiny" disabled={previewing} onClick={pull}
        title={previewing ? 'Back to the live scene first' : 'Move every player’s camera to what you are looking at'}>Pull everyone to my view</button>
    </>
  )
}
