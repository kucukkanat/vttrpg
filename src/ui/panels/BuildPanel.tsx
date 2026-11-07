/**
 * Build (GM): the table's authoring tools in one place. Walls and doors (draw, erase, who may open
 * doors), the fog brush, placed lights, wall detection for map images (a proposal to review),
 * prefabs ("slabs": capture a rectangle of props and walls, stamp it anywhere on the grid) and the
 * table display (a chrome-free view for a TV or second screen, sharing the GM's view, pulling
 * every player to it). The tools act on the table through `table/build/buildState`.
 */
import { useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import type { Prefab, Scene, Wall } from '@/core/doc'
import { newId, type PrefabId, type WallId } from '@/core/ids'
import { detectSceneWalls } from '@/import'
import { useBuildUi, toggleBuildTool, type BuildTool } from '@/table/build/buildState'
import { prefabSummary } from '@/table/build/prefab'
import { sceneWalls, wallSummary } from '@/table/build/wallEdit'
import { tableRuntime, useTableUi } from '@/table/tableState'
import { displayLinkFromInvite, makeView, PULL_CLEAR_MS } from '@/table/view'
import { isFogEnabled } from '@/table/vision'
import { copyText } from '../invite'
import { pushToast } from '../toasts'
import './BuildPanel.css'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function ToolButton({ tool, label, title }: { tool: BuildTool; label: string; title: string }) {
  const on = useBuildUi((s) => s.tool === tool)
  return (
    <button type="button" className={`tiny${on ? ' on' : ''}`} aria-pressed={on} title={title} onClick={() => toggleBuildTool(tool)}>{label}</button>
  )
}

export function BuildPanel({ controller }: { controller: GameController }) {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const allWalls = useGame((s) => s.walls)
  const walls = useMemo(() => (sceneId ? sceneWalls(allWalls, sceneId) : []), [allWalls, sceneId])
  const tool = useBuildUi((s) => s.tool)
  const showWalls = useBuildUi((s) => s.showWalls)
  const set = useBuildUi((s) => s.set)
  if (!controller.connection.isGm) return <div className="panel"><p className="muted small">The GM builds the table.</p></div>
  if (!scene || !sceneId) return <div className="panel"><p className="muted small">Add a scene first.</p></div>
  const update = (patch: Partial<Scene>) => void controller.dispatch({ type: 'scene.update', scene: sceneId, patch })
  const imported = scene.walls?.length ?? 0
  const removeDrawn = () => { if (walls.length) void controller.dispatch({ type: 'wall.remove', walls: walls.map((w) => w.id) }) }

  return (
    <div className="panel build-panel">
      <h3>Walls &amp; doors</h3>
      <div className="row build-tools" role="group" aria-label="Wall tools">
        <ToolButton tool="wall" label="Wall" title="Drag on the table to draw a wall; ends snap to cell corners and other walls (Alt: free)" />
        <ToolButton tool="door" label="Door" title="Drag to draw a door; tap a door with this tool to open or close it" />
        <ToolButton tool="erase" label="Erase" title="Tap or drag over walls and doors to remove them (imported walls too); tap a light to remove it" />
        <label className="check build-check">
          <input type="checkbox" checked={showWalls} onChange={(e) => set({ showWalls: e.target.checked })} />
          Show walls
        </label>
      </div>
      <p className="muted small build-status">
        {wallSummary(walls)}{imported ? ` · ${imported} imported` : ''}
        {tool && <span className="build-hint"> · Esc puts the tool away</span>}
      </p>
      <label className="check">
        <input type="checkbox" checked={!!scene.playersOpenDoors} onChange={(e) => update({ playersOpenDoors: e.target.checked })} />
        Players may open doors
      </label>
      <p className="muted small build-note">Tap a door on the table to open or close it; right-click locks it (locked doors stay shut for players).</p>
      {walls.length > 0 && (
        <div className="row">
          <button type="button" className="tiny danger" onClick={removeDrawn} title="Remove every wall and door drawn in this scene (Undo brings them back)">Remove drawn walls</button>
        </div>
      )}

      {scene.image && <DetectWalls controller={controller} />}

      <h3 className="build-head">Fog brush</h3>
      <FogBrush fogOn={isFogEnabled(scene)} />

      <h3 className="build-head">Lights</h3>
      <LightsBlock controller={controller} />

      <h3 className="build-head">Prefabs</h3>
      <Prefabs controller={controller} />

      <h3 className="build-head">Table display</h3>
      <DisplayBlock controller={controller} />
    </div>
  )
}

// ------------------------------------------------------------------ fog brush

function FogBrush({ fogOn }: { fogOn: boolean }) {
  const brush = useBuildUi((s) => s.brush)
  const set = useBuildUi((s) => s.set)
  return (
    <>
      <div className="row build-tools" role="group" aria-label="Fog brush">
        <ToolButton tool="fog-reveal" label="Reveal" title="Paint cells explored for the players" />
        <ToolButton tool="fog-hide" label="Hide" title="Paint cells back into fog" />
        <label className="build-range"><span className="muted small">Size {brush + 1}</span>
          <input type="range" min={0} max={5} step={1} value={brush} onChange={(e) => set({ brush: Number(e.target.value) })} aria-label="Brush size" />
        </label>
      </div>
      {!fogOn && <p className="muted small build-note">Fog of war is off for this scene (Scenes › Scene settings); painting shows once it is on.</p>}
    </>
  )
}

// ------------------------------------------------------------------ lights

function LightsBlock({ controller }: { controller: GameController }) {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const all = useGame((s) => s.lights)
  const lights = useMemo(() => Object.values(all).filter((l) => l.scene === sceneId), [all, sceneId])
  const radius = useBuildUi((s) => s.lightRadius)
  const color = useBuildUi((s) => s.lightColor)
  const set = useBuildUi((s) => s.set)
  return (
    <>
      <div className="row build-tools">
        <ToolButton tool="light" label="Place light" title="Tap the table to place a light" />
        <label className="build-range"><span className="muted small">Reach {radius}</span>
          <input type="range" min={1} max={20} step={1} value={radius} onChange={(e) => set({ lightRadius: Number(e.target.value) })} aria-label="Light reach in cells" />
        </label>
        <input type="color" className="build-color" value={color} onChange={(e) => set({ lightColor: e.target.value })} aria-label="Light colour" />
      </div>
      {lights.length > 0 && (
        <ul className="list build-list">
          {lights.map((l, i) => (
            <li key={l.id}>
              <span className="dot" style={{ background: l.color }} />
              <span className="build-name">Light {i + 1}</span>
              <input type="number" min={1} max={40} value={l.radius} aria-label={`Reach of light ${i + 1}`} className="build-num"
                onChange={(e) => void controller.dispatch({ type: 'light.update', light: l.id, patch: { radius: Math.max(1, Math.min(40, Number(e.target.value) || 1)) } })} />
              <input type="color" className="build-color" value={l.color} aria-label={`Colour of light ${i + 1}`}
                onChange={(e) => void controller.dispatch({ type: 'light.update', light: l.id, patch: { color: e.target.value } })} />
              <button type="button" className="icon" aria-label={`Remove light ${i + 1}`} onClick={() => void controller.dispatch({ type: 'light.remove', light: l.id })}>×</button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ------------------------------------------------------------------ wall detection

function DetectWalls({ controller }: { controller: GameController }) {
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const allWalls = useGame((s) => s.walls)
  const proposal = useBuildUi((s) => (s.proposal && s.proposal.scene === scene?.id ? s.proposal : null))
  const set = useBuildUi((s) => s.set)
  const [sensitivity, setSensitivity] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!scene?.image) return null
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
    <div className="build-detect">
      <h3 className="build-head">Detect walls</h3>
      <div className="row build-tools">
        <label className="build-range"><span className="muted small">Sensitivity {Math.round(sensitivity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Detection sensitivity" />
        </label>
        <button type="button" className="tiny" disabled={busy} onClick={() => void run()} title="Find walls in the map image's dark areas and lines; you review them before anything changes">
          {busy ? 'Looking…' : proposal ? 'Detect again' : 'Detect walls'}
        </button>
      </div>
      {proposal && (
        <>
          <p className="small build-status">
            {proposal.walls.length ? `${proposal.walls.length} ${proposal.walls.length === 1 ? 'wall' : 'walls'} proposed (blue on the table).` : 'No walls found; try a higher sensitivity.'}
          </p>
          <div className="row">
            <button type="button" className="tiny primary" disabled={!proposal.walls.length} onClick={accept}>Accept</button>
            <button type="button" className="tiny" onClick={() => set({ proposal: null })}>Discard</button>
          </div>
        </>
      )}
      {!proposal && detected.length > 0 && (
        <div className="row">
          <button type="button" className="tiny danger" onClick={() => void controller.dispatch({ type: 'wall.remove', walls: detected.map((w) => w.id) })}>
            Remove {detected.length} detected
          </button>
        </div>
      )}
      {error && <p className="small error">{error}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ prefabs

function Prefabs({ controller }: { controller: GameController }) {
  const prefabs = useGame((s) => s.prefabs)
  const list = useMemo(() => Object.values(prefabs).sort((a, b) => a.createdAt - b.createdAt), [prefabs])
  const stamp = useBuildUi((s) => s.stamp)
  const tool = useBuildUi((s) => s.tool)
  const set = useBuildUi((s) => s.set)
  const stamping = (id: PrefabId) => tool === 'prefab-stamp' && stamp?.prefab === id
  const pick = (p: Prefab) => {
    if (stamping(p.id)) set({ tool: null })
    else set({ tool: 'prefab-stamp', stamp: { prefab: p.id, turns: stamp?.prefab === p.id ? stamp.turns : 0 } })
  }
  const turn = () => { if (stamp) set({ stamp: { ...stamp, turns: (stamp.turns + 1) % 4 } }) }
  const rename = (p: Prefab, name: string) => {
    const n = name.trim()
    if (n && n !== p.name) void controller.dispatch({ type: 'prefab.upsert', prefab: { ...p, name: n } })
  }
  return (
    <>
      <div className="row build-tools">
        <ToolButton tool="prefab-capture" label="Capture" title="Drag a rectangle over props and walls to save them as a prefab (snaps to whole cells)" />
        {tool === 'prefab-stamp' && stamp && <button type="button" className="tiny" onClick={turn} title="Turn the stamp a quarter (R)">Turn ↻ {stamp.turns * 90}°</button>}
      </div>
      {list.length === 0
        ? <p className="muted small build-note">Build something with props and walls, then capture it to stamp copies anywhere; stamps land on the grid so pieces line up.</p>
        : (
          <ul className="list build-list">
            {list.map((p) => (
              <li key={p.id} className={stamping(p.id) ? 'selected' : ''}>
                <span className="build-prefab">
                  <input defaultValue={p.name} aria-label="Prefab name" className="build-name-input"
                    onBlur={(e) => rename(p, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                  <span className="muted small">{prefabSummary(p)}</span>
                </span>
                <button type="button" className={`tiny${stamping(p.id) ? ' on' : ''}`} aria-pressed={stamping(p.id)} onClick={() => pick(p)}
                  title={stamping(p.id) ? 'Stop stamping' : 'Tap the table to stamp copies (R turns)'}>{stamping(p.id) ? 'Stamping' : 'Stamp'}</button>
                <button type="button" className="icon" aria-label={`Delete ${p.name}`} onClick={() => {
                  if (stamping(p.id)) set({ tool: null, stamp: null })
                  void controller.dispatch({ type: 'prefab.remove', prefab: p.id })
                }}>×</button>
              </li>
            ))}
          </ul>
        )}
    </>
  )
}

// ------------------------------------------------------------------ display

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
      <p className="muted small build-note">
        A table view with no panels, for a TV or a second screen: it sees what the players see, never your secrets.
      </p>
      <div className="row build-tools">
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
      <div className="row">
        <button type="button" className="tiny" disabled={previewing} onClick={pull}
          title={previewing ? 'Back to the live scene first' : 'Move every player\'s camera to what you are looking at'}>Pull everyone to my view</button>
      </div>
    </>
  )
}
