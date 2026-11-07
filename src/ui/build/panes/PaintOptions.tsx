/**
 * The Inspector while a kit piece is in hand (a Kit card): the grid kit's tools (floor, wall, door, window, stairs, roof,
 * pillar, erase, pick), the kit, the piece in hand and its turn, and the room outline. Alt erases
 * while it is held. The piece palette is folded here until the Library's Kit shelf takes it in
 * hand; the level and cutaway live on the board's level control.
 */
import { useEffect, useMemo, useState } from 'react'
import { BUILTIN_KITS, type KitManifest, type KitPiece, type KitSlot } from '@/core/kits'
import { useGame } from '@/state/store'
import { isPlainWall } from '@/table/kits/autoJoin'
import { setKitTool, TOOL_SLOT, toolForSlot, useKitUi, type KitTool } from '@/table/kits/kitState'
import { tileLevels } from '@/table/kits/kitWalls'
import { loadBuiltinKits, useKitManifests } from '@/table/kits/manifests'
import { LIBRARY_BASE } from '../../library'
import { Fold } from '../Fold'

const TOOLS: { tool: KitTool; label: string; title: string }[] = [
  { tool: 'floor', label: 'Floor', title: 'Drag a rectangle of floor (tap: one tile)' },
  { tool: 'wall', label: 'Wall', title: 'Drag along the grid lines; corners, tees and crossings join by themselves. Shift: a room outline' },
  { tool: 'door', label: 'Door', title: 'Tap a wall to put a door in it' },
  { tool: 'window', label: 'Window', title: 'Tap a wall to put a window in it' },
  { tool: 'stair', label: 'Stairs', title: 'Tap a cell: stairs up to the next level (R turns them)' },
  { tool: 'roof', label: 'Roof', title: 'Drag over a room to roof it; tap to place one roof piece' },
  { tool: 'pillar', label: 'Pillar', title: 'Tap a grid corner to place a pillar' },
  { tool: 'erase', label: 'Erase', title: 'Drag a rectangle or tap a piece to remove it (or hold Alt with any tool)' },
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

/** The piece the active tool places: picked in the palette, else the kit's first of that slot. */
function pieceInHand(m: KitManifest | undefined, tool: KitTool | null, pieces: Partial<Record<KitSlot, string>>, wallPiece: string | null): KitPiece | undefined {
  if (!m || !tool) return undefined
  if (tool === 'wall') return m.pieces.find((p) => p.id === (wallPiece ?? pieces.wall)) ?? m.pieces.find((p) => p.slot === 'wall')
  const slot = TOOL_SLOT[tool]
  if (!slot) return undefined
  return m.pieces.find((p) => p.id === pieces[slot]) ?? m.pieces.find((p) => p.slot === slot || (tool === 'pillar' && p.slot === 'corner'))
}

export function PaintOptions() {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const tiles = useGame((s) => (sceneId ? s.tiles[sceneId] : undefined))
  const manifests = useKitManifests((s) => s.manifests)
  const ui = useKitUi()
  const [failed, setFailed] = useState(false)
  useEffect(() => { void loadBuiltinKits().then((list) => setFailed(list.length === 0)) }, [])
  const manifest: KitManifest | undefined = manifests[ui.kit]
  const levels = useMemo(() => tileLevels(tiles), [tiles])
  if (!sceneId) return <p className="muted small">Add a scene first.</p>
  const active = ui.tool
  const count = Object.values(tiles?.chunks ?? {}).reduce((n, c) => n + Object.keys(c).length, 0)
  const hand = pieceInHand(manifest, active, ui.pieces, ui.wallPiece)

  const pickPiece = (p: KitPiece) => {
    if (!manifest) return
    const plain = isPlainWall({ piece: p, manifest })
    const slot = p.slot
    ui.set({ pieces: { ...ui.pieces, [slot]: p.id }, wallPiece: slot === 'wall' && !plain ? p.id : slot === 'wall' ? null : ui.wallPiece })
    const tool = slot === 'corner' && plain ? 'wall' : toolForSlot(slot)
    if (active !== tool) setKitTool(tool)
  }
  const inHand = (p: KitPiece) => hand?.id === p.id && (active !== 'wall' || !!ui.wallPiece || p.slot === 'wall')

  return (
    <>
      <div className="bw-seg bw-seg--wrap" role="radiogroup" aria-label="Kit tool">
        {TOOLS.map((t) => (
          <button key={t.tool} type="button" role="radio" aria-checked={active === t.tool} className={`bw-seg-btn${active === t.tool ? ' on' : ''}`} title={t.title}
            onClick={() => { if (t.tool === 'wall') ui.set({ wallPiece: null }); if (active !== t.tool) setKitTool(t.tool) }}>{t.label}</button>
        ))}
      </div>
      <div className="bw-hand">
        {hand && <img src={thumbUrl(hand)} alt="" width={40} height={40} />}
        <span className="bw-grow small">
          <span className="muted">In hand</span><br />
          <strong>{active === 'erase' ? 'Eraser' : active === 'pick' ? 'Tap a piece to pick it' : hand?.title ?? '—'}</strong>
        </span>
        <button type="button" className="tiny" title="Turn the piece a quarter (R)" onClick={() => ui.set({ rot: (ui.rot + 1) % 4 })}>⟳ {TURN[ui.rot]}</button>
      </div>
      {active === 'wall' && !ui.wallPiece && (
        <label className="check">
          <input type="checkbox" checked={ui.outline} onChange={(e) => ui.set({ outline: e.target.checked })} />
          Room outline (Shift)
        </label>
      )}
      <p className="muted small bw-note">Hold Alt to erase · R turns · Esc puts the tool away</p>
      <label className="bw-field">
        <span className="muted small">Kit</span>
        <select value={ui.kit} onChange={(e) => ui.set({ kit: e.target.value, pieces: {}, wallPiece: null })}>
          {BUILTIN_KITS.map((id) => <option key={id} value={id}>{manifests[id]?.title ?? id}</option>)}
        </select>
      </label>
      {failed && <p className="muted small">The kits could not be loaded.</p>}
      <Fold id="paint.pieces" title="Pieces" summary={manifest ? String(manifest.pieces.length) : ''}>
        {manifest
          ? GROUPS.map((g) => {
            const pieces = manifest.pieces.filter((p) => g.slot.includes(p.slot))
            if (!pieces.length) return null
            return (
              <section key={g.label} className="bw-kit-group">
                <h4>{g.label}</h4>
                <ul className="bw-kit-palette">
                  {pieces.map((p) => (
                    <li key={p.id}>
                      <button type="button" className={`bw-kit-piece${inHand(p) ? ' on' : ''}`} title={p.title} aria-pressed={inHand(p)} onClick={() => pickPiece(p)}>
                        <img src={thumbUrl(p)} alt="" loading="lazy" width={48} height={48} />
                        <span>{p.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
          : !failed && <p className="muted small">Loading the kit…</p>}
      </Fold>
      <p className="muted small bw-note">{count ? `${count} kit pieces in this scene · levels ${levels.join(', ')}` : 'No kit pieces in this scene yet.'}</p>
    </>
  )
}
