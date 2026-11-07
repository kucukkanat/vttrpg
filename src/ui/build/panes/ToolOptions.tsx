/**
 * The Inspector while a tool is out: its options. Walls (wall, door or eraser, show walls, who may
 * open doors, wall detection for map images, removing drawn walls), Light (colour and reach for new
 * lights, and the placed lights) and Fog (reveal or hide, brush size, reveal all, hide all, reset).
 * Every option acts through the build tool state or `controller.dispatch`.
 */
import { useMemo, useState } from 'react'
import type { GameController } from '../../controller'
import { useGame } from '@/state/store'
import type { Scene, Wall } from '@/core/doc'
import { newId, type WallId } from '@/core/ids'
import { detectSceneWalls } from '@/import'
import { useBuildUi, type BuildTool } from '@/table/build/buildState'
import { sceneWalls, wallSummary } from '@/table/build/wallEdit'
import { fogStatus, isFogEnabled } from '@/table/vision'
import { pushToast } from '../../toasts'
import { Fold } from '../Fold'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A row of mutually exclusive sub-tools (wall / door / erase; reveal / hide). */
function SubTools({ label, tools }: { label: string; tools: { tool: BuildTool; label: string; title: string }[] }) {
  const tool = useBuildUi((s) => s.tool)
  const set = useBuildUi((s) => s.set)
  return (
    <div className="bw-seg" role="radiogroup" aria-label={label}>
      {tools.map((t) => (
        <button key={t.tool} type="button" role="radio" aria-checked={tool === t.tool} className={`bw-seg-btn${tool === t.tool ? ' on' : ''}`} title={t.title}
          onClick={() => set({ tool: t.tool })}>{t.label}</button>
      ))}
    </div>
  )
}

function useActiveScene(): { sceneId: Scene['id'] | null; scene: Scene | undefined } {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  return { sceneId, scene }
}

// ------------------------------------------------------------------ walls

export function WallsOptions({ controller }: { controller: GameController }) {
  const { sceneId, scene } = useActiveScene()
  const allWalls = useGame((s) => s.walls)
  const walls = useMemo(() => (sceneId ? sceneWalls(allWalls, sceneId) : []), [allWalls, sceneId])
  const showWalls = useBuildUi((s) => s.showWalls)
  const set = useBuildUi((s) => s.set)
  if (!scene || !sceneId) return <p className="muted small">Add a scene first.</p>
  const update = (patch: Partial<Scene>) => void controller.dispatch({ type: 'scene.update', scene: sceneId, patch })
  const imported = scene.walls?.length ?? 0
  return (
    <>
      <SubTools label="Wall tool" tools={[
        { tool: 'wall', label: 'Wall', title: 'Drag on the table to draw a wall; ends snap to cell corners and other walls (Alt: free)' },
        { tool: 'door', label: 'Door', title: 'Drag to draw a door; tap a door with this tool to open or close it' },
        { tool: 'erase', label: 'Erase', title: 'Tap or drag over walls and doors to remove them (imported walls too); tap a light to remove it' },
      ]} />
      <p className="muted small bw-note">{wallSummary(walls)}{imported ? ` · ${imported} imported` : ''} · Esc puts the tool away</p>
      <label className="check">
        <input type="checkbox" checked={showWalls} onChange={(e) => set({ showWalls: e.target.checked })} />
        Show walls
      </label>
      <label className="check">
        <input type="checkbox" checked={!!scene.playersOpenDoors} onChange={(e) => update({ playersOpenDoors: e.target.checked })} />
        Players may open doors
      </label>
      <p className="muted small bw-note">Tap a door to open or close it; right-click locks it (locked doors stay shut for players).</p>
      {scene.image && <Fold id="walls.detect" title="Detect walls from the map"><DetectWalls controller={controller} scene={scene} /></Fold>}
      {walls.length > 0 && (
        <button type="button" className="tiny danger" onClick={() => void controller.dispatch({ type: 'wall.remove', walls: walls.map((w) => w.id) })}
          title="Remove every wall and door drawn in this scene (Undo brings them back)">Remove drawn walls</button>
      )}
    </>
  )
}

function DetectWalls({ controller, scene }: { controller: GameController; scene: Scene }) {
  const allWalls = useGame((s) => s.walls)
  const proposal = useBuildUi((s) => (s.proposal && s.proposal.scene === scene.id ? s.proposal : null))
  const set = useBuildUi((s) => s.set)
  const [sensitivity, setSensitivity] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!scene.image) return null
  const detected = Object.values(allWalls).filter((w) => w.scene === scene.id && w.source === 'detected')
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const url = await controller.assets.resolve(scene.image!.asset)
      const blob = await (await fetch(url)).blob()
      const result = await detectSceneWalls(scene, blob, sensitivity)
      set({ proposal: { scene: scene.id, walls: result.walls } })
    } catch (e) {
      setError(`Could not read the map: ${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const accept = () => {
    if (!proposal) return
    const walls: Wall[] = proposal.walls.map((w) => ({ id: newId<'WallId'>() as WallId, scene: scene.id, a: w.a, b: w.b, source: 'detected' }))
    if (walls.length) void controller.dispatch({ type: 'wall.add', walls })
    set({ proposal: null })
    pushToast({ text: `Added ${walls.length} ${walls.length === 1 ? 'wall' : 'walls'}`, ttl: 2500 })
  }
  return (
    <>
      <label className="bw-range"><span className="muted small">Sensitivity {Math.round(sensitivity * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Detection sensitivity" />
      </label>
      <div className="row bw-row">
        <button type="button" className="tiny" disabled={busy} onClick={() => void run()} title="Find walls in the map image's dark areas and lines; you review them before anything changes">
          {busy ? 'Looking…' : proposal ? 'Detect again' : 'Detect walls'}
        </button>
        {proposal && <button type="button" className="tiny primary" disabled={!proposal.walls.length} onClick={accept}>Accept</button>}
        {proposal && <button type="button" className="tiny" onClick={() => set({ proposal: null })}>Discard</button>}
        {!proposal && detected.length > 0 && (
          <button type="button" className="tiny danger" onClick={() => void controller.dispatch({ type: 'wall.remove', walls: detected.map((w) => w.id) })}>Remove {detected.length} detected</button>
        )}
      </div>
      {proposal && (
        <p className="small bw-note">{proposal.walls.length ? `${proposal.walls.length} ${proposal.walls.length === 1 ? 'wall' : 'walls'} proposed (blue on the table).` : 'No walls found; try a higher sensitivity.'}</p>
      )}
      {error && <p className="small error">{error}</p>}
    </>
  )
}

// ------------------------------------------------------------------ light

export function LightOptions({ controller }: { controller: GameController }) {
  const { sceneId } = useActiveScene()
  const all = useGame((s) => s.lights)
  const lights = useMemo(() => Object.values(all).filter((l) => l.scene === sceneId), [all, sceneId])
  const radius = useBuildUi((s) => s.lightRadius)
  const color = useBuildUi((s) => s.lightColor)
  const set = useBuildUi((s) => s.set)
  return (
    <>
      <p className="muted small bw-note">Tap the table to place a light. Erase (Walls) or × below removes one.</p>
      <div className="row bw-row">
        <label className="bw-range"><span className="muted small">Reach {radius} cells</span>
          <input type="range" min={1} max={20} step={1} value={radius} onChange={(e) => set({ lightRadius: Number(e.target.value) })} aria-label="Light reach in cells" />
        </label>
        <input type="color" className="bw-color" value={color} onChange={(e) => set({ lightColor: e.target.value })} aria-label="Light colour" />
      </div>
      {lights.length > 0 && (
        <Fold id="light.placed" title="Placed lights" summary={String(lights.length)}>
          <ul className="list bw-list">
            {lights.map((l, i) => (
              <li key={l.id}>
                <span className="dot" style={{ background: l.color }} />
                <span className="bw-grow">Light {i + 1}</span>
                <input type="number" min={1} max={40} value={l.radius} aria-label={`Reach of light ${i + 1}`} className="bw-num"
                  onChange={(e) => void controller.dispatch({ type: 'light.update', light: l.id, patch: { radius: Math.max(1, Math.min(40, Number(e.target.value) || 1)) } })} />
                <input type="color" className="bw-color" value={l.color} aria-label={`Colour of light ${i + 1}`}
                  onChange={(e) => void controller.dispatch({ type: 'light.update', light: l.id, patch: { color: e.target.value } })} />
                <button type="button" className="icon" aria-label={`Remove light ${i + 1}`} onClick={() => void controller.dispatch({ type: 'light.remove', light: l.id })}>×</button>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </>
  )
}

// ------------------------------------------------------------------ fog

export function FogOptions({ controller }: { controller: GameController }) {
  const { scene } = useActiveScene()
  const fog = useGame((s) => (s.meta?.activeScene ? s.fog[s.meta.activeScene] : undefined))
  const brush = useBuildUi((s) => s.brush)
  const set = useBuildUi((s) => s.set)
  if (!scene) return <p className="muted small">Add a scene first.</p>
  const fogOn = isFogEnabled(scene)
  const explored = (fog?.revealed.length ?? 0) > 0 || !!fog?.revealAll
  const revealAll = () => void controller.dispatch({ type: 'fog.revealAll', scene: scene.id })
  const hideAll = () => void controller.dispatch({ type: 'fog.reset', scene: scene.id })
  /** Back to the starting state: fog on and nothing explored. */
  const reset = async () => {
    if (!fogOn) await controller.dispatch({ type: 'scene.update', scene: scene.id, patch: { fogEnabled: true } })
    if (explored) await controller.dispatch({ type: 'fog.reset', scene: scene.id })
  }
  return (
    <>
      <SubTools label="Fog brush" tools={[
        { tool: 'fog-reveal', label: 'Reveal', title: 'Paint cells explored for the players' },
        { tool: 'fog-hide', label: 'Hide', title: 'Paint cells back into fog' },
      ]} />
      <label className="bw-range"><span className="muted small">Brush size {brush + 1}</span>
        <input type="range" min={0} max={5} step={1} value={brush} onChange={(e) => set({ brush: Number(e.target.value) })} aria-label="Brush size" />
      </label>
      <p className="muted small bw-note">{fogStatus(scene, fog)}{!fogOn ? ' · painting shows once fog is on (Reset turns it on)' : ''}</p>
      <div className="row bw-row">
        <button type="button" className="tiny" disabled={!fogOn || !!fog?.revealAll} title="Players see the whole map" onClick={revealAll}>Reveal all</button>
        <button type="button" className="tiny" disabled={!fogOn || !explored} title="Forget what has been explored; tokens reveal what they see from here" onClick={hideAll}>Hide all</button>
        <button type="button" className="tiny" disabled={fogOn && !explored} title="Fog on with nothing explored" onClick={() => void reset()}>Reset</button>
      </div>
    </>
  )
}
