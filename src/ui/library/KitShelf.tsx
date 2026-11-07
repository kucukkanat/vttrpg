/**
 * The Library's Kit shelf: the grid kit's pieces by slot (floors, walls, doors, windows, stairs,
 * roofs, pillars) with thumbnails, and the kit dropdown. Picking a card arms the kit paint tool
 * with that piece (`armKitPiece`); the table's kit tool does the painting. Levels and the cutaway
 * live in the Build scene bar.
 */
import { useEffect, useMemo, useState } from 'react'
import { BUILTIN_KITS, type KitPiece } from '@/core/kits'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { armKitPiece, pieceInHand, useKitUi } from '@/table/kits/kitState'
import { loadBuiltinKits, useKitManifests } from '@/table/kits/manifests'
import { LIBRARY_BASE } from '../library'
import { LibIcon } from './libraryIcons'
import { noteRecentlyPlaced, toggleFavouriteModel, useLibraryPrefs } from './libraryPrefs'
import type { LibraryFilter } from './libraryView'
import { closePhoneSheet } from './sheet'
import { kitShelf } from './shelves'

const thumbUrl = (p: KitPiece) => LIBRARY_BASE + p.catalogue.replace(/^builtin:/, '').replace(/\.glb$/, '.webp')
const TURN = ['0°', '90°', '180°', '270°']

export default function KitShelf({ filter, query, phone }: { filter: LibraryFilter; query: string; phone: boolean }) {
  const manifests = useKitManifests((s) => s.manifests)
  const kit = useKitUi((s) => s.kit)
  const rot = useKitUi((s) => s.rot)
  const pieces = useKitUi((s) => s.pieces)
  const wallPiece = useKitUi((s) => s.wallPiece)
  const kitTool = useKitUi((s) => s.tool)
  const buildTool = useBuildUi((s) => s.tool)
  const recent = useLibraryPrefs((s) => s.recent)
  const favourites = useLibraryPrefs((s) => s.favourites)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { void loadBuiltinKits().then((list) => setFailed(list.length === 0)) }, [])
  const manifest = manifests[kit]
  const groups = useMemo(() => kitShelf(manifest, { query, filter, recent, favourites }), [manifest, query, filter, recent, favourites])
  const active = buildTool === 'kit' ? kitTool : null

  if (!sceneId) return <p className="muted small lib-empty">Add a scene first.</p>
  const pick = (p: KitPiece) => {
    if (!manifest) return
    armKitPiece(manifest, p)
    noteRecentlyPlaced(p.catalogue)
    closePhoneSheet(phone)
  }
  const empty = !manifest ? (failed ? 'The kits could not be loaded.' : 'Loading the kit…')
    : filter === 'favourites' && !query ? 'Star a kit piece to keep it here.'
      : filter === 'recent' && !query ? 'Kit pieces you paint with show up here.'
        : `Nothing matches${query ? ` “${query}”` : ''}.`

  return (
    <div className="lib-shelf lib-kit">
      <div className="lib-opts" role="group" aria-label="Kit">
        <label className="lib-opt">
          <span className="muted small">Kit</span>
          <select value={kit} aria-label="Kit" onChange={(e) => useKitUi.getState().set({ kit: e.target.value, pieces: {}, wallPiece: null })}>
            {BUILTIN_KITS.map((id) => <option key={id} value={id}>{manifests[id]?.title ?? id}</option>)}
          </select>
        </label>
        <button type="button" className="tiny" title="Turn the piece a quarter (R)" onClick={() => useKitUi.getState().set({ rot: (rot + 1) % 4 })}>⟳ {TURN[rot]}</button>
      </div>
      <div className="lib-scroll">
        {groups.length === 0
          ? <p className="muted small lib-empty">{empty}</p>
          : groups.map((g) => (
            <section key={g.label} className="lib-section">
              <h4 className="lib-section-title">{g.label} <span className="muted">· {g.pieces.length}</span></h4>
              <ul className="lib-tiles">
                {g.pieces.map((p) => {
                  const on = !!manifest && pieceInHand({ kit, pieces, wallPiece }, active, manifest, p)
                  const fav = favourites.includes(p.catalogue)
                  return (
                    <li key={p.id} className={`lib-tile${on ? ' held' : ''}`}>
                      <button type="button" className="lib-tile-pick" aria-pressed={on} title={`${p.title}: click to paint with it`} onClick={() => pick(p)}>
                        <span className="lib-thumb"><img src={thumbUrl(p)} alt="" loading="lazy" decoding="async" draggable={false} /></span>
                        <span className="lib-title">{p.title}</span>
                      </button>
                      <button type="button" className={`lib-star${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? `Unstar ${p.title}` : `Star ${p.title}`}
                        onClick={() => toggleFavouriteModel(p.catalogue)}>
                        <LibIcon name="star" size={14} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
      </div>
    </div>
  )
}
