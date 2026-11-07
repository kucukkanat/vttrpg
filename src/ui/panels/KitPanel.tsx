/**
 * Kit (GM, the Build tray): build rooms with storeys from a grid kit. Pick a kit, then a tool or a
 * piece from the palette; the table does the rest (src/table/kits). The level row sets the storey
 * being built and the cutaway that hides what is above it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { BUILTIN_KITS, type KitManifest, type KitPiece, type KitSlot } from '@/core/kits'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { isPlainWall } from '@/table/kits/autoJoin'
import { setKitTool, TOOL_SLOT, toolForSlot, useKitUi, type KitTool } from '@/table/kits/kitState'
import { tileLevels } from '@/table/kits/kitWalls'
import { loadBuiltinKits, useKitManifests } from '@/table/kits/manifests'
import { LIBRARY_BASE } from '../library'
import './BuildPanel.css'
import './KitPanel.css'

const TOOLS: { tool: KitTool; label: string; title: string }[] = [
  { tool: 'floor', label: 'Floor', title: 'Drag a rectangle of floor (tap: one tile)' },
  { tool: 'wall', label: 'Wall', title: 'Drag along the grid lines; corners, tees and crossings join by themselves. Shift: a room outline' },
  { tool: 'door', label: 'Door', title: 'Tap a wall to put a door in it' },
  { tool: 'window', label: 'Window', title: 'Tap a wall to put a window in it' },
  { tool: 'stair', label: 'Stairs', title: 'Tap a cell: stairs up to the next level (R turns them)' },
  { tool: 'roof', label: 'Roof', title: 'Drag over a room to roof it; tap to place one roof piece' },
  { tool: 'pillar', label: 'Pillar', title: 'Tap a grid corner to place a pillar' },
  { tool: 'erase', label: 'Erase', title: 'Drag a rectangle or tap a piece to remove it' },
  { tool: 'pick', label: 'Pick', title: 'Tap a piece on the board to take it in hand' },
]

const GROUPS: { slot: KitSlot[]; label: string }[] = [
  { slot: ['floor'], label: 'Floors' },
  { slot: ['wall'], label: 'Walls' },
  { slot: ['door'], label: 'Doors' },
  { slot: ['window'], label: 'Windows' },
  { slot: ['corner', 'pillar'], label: 'Corners and pillars' },
  { slot: ['stair'], label: 'Stairs' },
  { slot: ['roof'], label: 'Roofs' },
]

const TURN = ['0°', '90°', '180°', '270°']

const thumbUrl = (p: KitPiece) => LIBRARY_BASE + p.catalogue.replace(/^builtin:/, '').replace(/\.glb$/, '.webp')

export function KitPanel({ controller }: { controller: GameController }) {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const tiles = useGame((s) => (sceneId ? s.tiles[sceneId] : undefined))
  const manifests = useKitManifests((s) => s.manifests)
  const ui = useKitUi()
  const buildTool = useBuildUi((s) => s.tool)
  const [failed, setFailed] = useState(false)
  useEffect(() => { void loadBuiltinKits().then((list) => setFailed(list.length === 0)) }, [])
  const manifest: KitManifest | undefined = manifests[ui.kit]
  const levels = useMemo(() => tileLevels(tiles), [tiles])
  const top = Math.max(levels[levels.length - 1] ?? 0, ui.level)
  if (!controller.connection.isGm) return <div className="panel"><p className="muted small">The GM builds the table.</p></div>
  if (!sceneId) return <div className="panel"><p className="muted small">Add a scene first.</p></div>
  const active = buildTool === 'kit' ? ui.tool : null
  const count = Object.values(tiles?.chunks ?? {}).reduce((n, c) => n + Object.keys(c).length, 0)

  const pickPiece = (p: KitPiece) => {
    if (!manifest) return
    const plain = isPlainWall({ piece: p, manifest })
    const slot = p.slot
    ui.set({ pieces: { ...ui.pieces, [slot]: p.id }, wallPiece: slot === 'wall' && !plain ? p.id : slot === 'wall' ? null : ui.wallPiece })
    const tool = slot === 'corner' && plain ? 'wall' : toolForSlot(slot)
    if (active !== tool) setKitTool(tool)
  }
  const inHand = (p: KitPiece) => {
    if (!active) return false
    if (active === 'wall') return ui.wallPiece ? ui.wallPiece === p.id : false
    const slot = TOOL_SLOT[active]
    if (!slot || (p.slot !== slot && !(active === 'pillar' && p.slot === 'corner'))) return false
    return (ui.pieces[p.slot] ?? '') === p.id
  }

  return (
    <div className="panel build-panel kit-panel">
      <div className="row kit-head">
        <label className="kit-field">
          <span className="muted small">Kit</span>
          <select value={ui.kit} onChange={(e) => ui.set({ kit: e.target.value, pieces: {}, wallPiece: null })}>
            {BUILTIN_KITS.map((id) => <option key={id} value={id}>{manifests[id]?.title ?? id}</option>)}
          </select>
        </label>
        <div className="kit-turn">
          <span className="muted small">Turn</span>
          <button type="button" className="tiny" title="Turn the piece a quarter (R)" onClick={() => ui.set({ rot: (ui.rot + 1) % 4 })}>⟳ {TURN[ui.rot]}</button>
        </div>
      </div>
      {failed && <p className="muted small">The kits could not be loaded.</p>}

      <div className="row build-tools kit-tools" role="group" aria-label="Kit tools">
        {TOOLS.map((t) => (
          <button key={t.tool} type="button" className={`tiny${active === t.tool ? ' on' : ''}`} aria-pressed={active === t.tool} title={t.title}
            onClick={() => { if (t.tool === 'wall') ui.set({ wallPiece: null }); setKitTool(t.tool) }}>{t.label}</button>
        ))}
      </div>
      {active === 'wall' && !ui.wallPiece && (
        <label className="check build-check kit-outline">
          <input type="checkbox" checked={ui.outline} onChange={(e) => ui.set({ outline: e.target.checked })} />
          Room outline (Shift)
        </label>
      )}

      <div className="kit-levels" role="group" aria-label="Levels">
        <span className="muted small">Level</span>
        <button type="button" className="tiny" aria-label="Level down" disabled={ui.level === 0}
          onClick={() => ui.set({ level: ui.level - 1, ...(ui.cutaway !== null ? { cutaway: ui.level - 1 } : {}) })}>−</button>
        <strong className="kit-level" aria-live="polite">{ui.level}</strong>
        <button type="button" className="tiny" aria-label="Level up"
          onClick={() => ui.set({ level: ui.level + 1, ...(ui.cutaway !== null ? { cutaway: ui.level + 1 } : {}) })}>+</button>
        <span className="muted small kit-keys">PgUp / PgDn</span>
      </div>
      <div className="kit-levels" role="group" aria-label="Cutaway">
        <span className="muted small">Cutaway</span>
        <input type="range" min={0} max={top + 1} step={1} value={ui.cutaway ?? top + 1} aria-label="Hide everything above this level"
          onChange={(e) => { const v = Number(e.target.value); ui.set({ cutaway: v > top ? null : v }) }} />
        <span className="small kit-cut">{ui.cutaway === null ? 'auto' : `≤ ${ui.cutaway}`}</span>
        <label className="check build-check">
          <input type="checkbox" checked={ui.cutaway === null} onChange={(e) => ui.set({ cutaway: e.target.checked ? null : ui.level })} />
          Follow token
        </label>
      </div>

      {manifest
        ? GROUPS.map((g) => {
          const pieces = manifest.pieces.filter((p) => g.slot.includes(p.slot))
          if (!pieces.length) return null
          return (
            <section key={g.label} className="kit-group">
              <h4>{g.label}</h4>
              <ul className="kit-palette">
                {pieces.map((p) => (
                  <li key={p.id}>
                    <button type="button" className={`kit-piece${inHand(p) ? ' on' : ''}`} title={p.title} aria-pressed={inHand(p)} onClick={() => pickPiece(p)}>
                      <img src={thumbUrl(p)} alt="" loading="lazy" width={64} height={64} />
                      <span>{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
        : !failed && <p className="muted small">Loading the kit…</p>}
      <p className="muted small build-status">{count ? `${count} kit pieces in this scene · levels ${levels.join(', ')}` : 'No kit pieces in this scene yet.'}</p>
    </div>
  )
}
