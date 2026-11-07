/**
 * The Library's Lights and Walls & doors shelves (reports/One mode plan.md).
 *
 * - Lights: light sources (Warm light, Cold light, Spotlight: invisible light props) and the lit
 *   models (torches, candles, lanterns, campfires, braziers), each placed with its light.
 * - Walls & doors: the Invisible wall (click, click; clicks chain) and Invisible door (drag across
 *   the doorway) for map images, wall, gate and door models, and the kit's straight wall, door and
 *   window pieces placed as props (the Kit shelf still paints them on the grid).
 *
 * Picking a model card picks it up for the table's place tool; the invisible ones arm their tool.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import type { CatalogueEntry } from '@/core/catalogue'
import { BUILTIN_KITS, type KitManifest } from '@/core/kits'
import { isNoModel } from '@/core/propParts'
import { armSegmentTool, pickUpModel, useBuildUi } from '@/table/build/buildState'
import { lightSourceHeld } from '@/table/build/lightSources'
import { loadBuiltinKits, useKitManifests } from '@/table/kits/manifests'
import { catalogueThumbnailUrl } from '../catalogue'
import { LibIcon } from './libraryIcons'
import { noteRecentlyPlaced, toggleFavouriteModel, useLibraryPrefs } from './libraryPrefs'
import type { LibraryFilter } from './libraryView'
import { closePhoneSheet } from './sheet'
import { lightShelf, lightSourceRef, segmentRef, wallShelf, type ShelfPrefs } from './shelves'
import { heldFromEntry, useBuiltinCatalogue, useMyModels } from './useCatalogue'

interface ShelfProps { controller: GameController; filter: LibraryFilter; query: string; phone: boolean }

function usePrefs(filter: LibraryFilter, query: string): ShelfPrefs {
  const recent = useLibraryPrefs((s) => s.recent)
  const favourites = useLibraryPrefs((s) => s.favourites)
  return useMemo(() => ({ query, filter, recent, favourites }), [query, filter, recent, favourites])
}

function useEntries(): { entries: CatalogueEntry[]; mine: Set<string>; loading: boolean } {
  const builtin = useBuiltinCatalogue()
  const own = useMyModels()
  return useMemo(() => ({ entries: [...own, ...(builtin ?? [])], mine: new Set(own.map((e) => e.id)), loading: builtin === null }), [builtin, own])
}

/** One card: a thumbnail (or a swatch), the title, a star. */
function Tile({ title, hint, thumb, swatch, icon, held, fav, onPick, onStar }: {
  title: string; hint: string; thumb?: string | undefined; swatch?: string; icon?: 'wall' | 'door'; held: boolean; fav: boolean
  onPick(): void; onStar(): void
}) {
  return (
    <li className={`lib-tile${held ? ' held' : ''}`}>
      <button type="button" className="lib-tile-pick" aria-pressed={held} title={hint} onClick={onPick}>
        <span className="lib-thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" draggable={false} />
            : swatch ? <span className="lib-swatch" style={{ background: `radial-gradient(circle, ${swatch} 0%, ${swatch}55 45%, transparent 70%)` }} aria-hidden />
              : <SegmentGlyph kind={icon ?? 'wall'} />}
        </span>
        <span className="lib-title">{title}</span>
      </button>
      <button type="button" className={`lib-star${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? `Unstar ${title}` : `Star ${title}`} onClick={onStar}>
        <LibIcon name="star" size={14} />
      </button>
    </li>
  )
}

/** A dashed segment (wall) or a segment with a gap (door) for the invisible cards. */
function SegmentGlyph({ kind }: { kind: 'wall' | 'door' }) {
  return (
    <svg viewBox="0 0 48 48" width="70%" height="70%" aria-hidden>
      {kind === 'wall'
        ? <line x1="6" y1="36" x2="42" y2="12" stroke="currentColor" strokeWidth="4" strokeDasharray="6 4" strokeLinecap="round" />
        : <>
          <line x1="4" y1="30" x2="16" y2="30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="32" y1="30" x2="44" y2="30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M16 30 L28 14" stroke="#3ee08f" strokeWidth="4" strokeLinecap="round" />
          <path d="M16 18 A14 14 0 0 1 30 30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
        </>}
    </svg>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null
  return (
    <section className="lib-section">
      <h4 className="lib-section-title">{title} <span className="muted">· {count}</span></h4>
      <ul className="lib-tiles">{children}</ul>
    </section>
  )
}

function emptyText(filter: LibraryFilter, query: string, loading: boolean): string {
  if (loading) return 'Loading the library…'
  if (filter === 'favourites' && !query) return 'Star a card to keep it here.'
  if (filter === 'recent' && !query) return 'What you place shows up here.'
  return `Nothing matches${query ? ` “${query}”` : ''}.`
}

export function LightsShelf({ filter, query, phone }: ShelfProps) {
  const prefs = usePrefs(filter, query)
  const { entries, mine, loading } = useEntries()
  const shelf = useMemo(() => lightShelf(entries, prefs, mine), [entries, prefs, mine])
  const held = useBuildUi((s) => (s.tool === 'place' ? s.held : null))
  const favourites = prefs.favourites
  const pickSource = (id: Parameters<typeof lightSourceHeld>[0]) => {
    pickUpModel(lightSourceHeld(id))
    noteRecentlyPlaced(lightSourceRef(id))
    closePhoneSheet(phone)
  }
  const pickEntry = (e: CatalogueEntry) => {
    pickUpModel(heldFromEntry(e))
    noteRecentlyPlaced(e.id)
    closePhoneSheet(phone)
  }
  const total = shelf.sources.length + shelf.models.length
  return (
    <div className="lib-shelf lib-parts">
      <div className="lib-scroll">
        {total === 0 && <p className="muted small lib-empty">{emptyText(filter, query, loading)}</p>}
        <Section title="Light sources" count={shelf.sources.length}>
          {shelf.sources.map((s) => (
            <Tile key={s.id} title={s.title} hint={`${s.title}: ${s.hint}. Click, then click the board to place; colour and reach in the Inspector`}
              swatch={s.light.color} held={!!held && isNoModel(held.model) && held.title === s.title} fav={favourites.includes(lightSourceRef(s.id))}
              onPick={() => pickSource(s.id)} onStar={() => toggleFavouriteModel(lightSourceRef(s.id))} />
          ))}
        </Section>
        <Section title="Lit models" count={shelf.models.length}>
          {shelf.models.map(({ entry, light }) => (
            <Tile key={entry.id} title={entry.title} hint={`${entry.title}: shines ${light.radius} cells. Click, then click the board to place`}
              thumb={catalogueThumbnailUrl(entry)} held={held?.catalogue === entry.id} fav={favourites.includes(entry.id)}
              onPick={() => pickEntry(entry)} onStar={() => toggleFavouriteModel(entry.id)} />
          ))}
        </Section>
      </div>
    </div>
  )
}

export function WallsShelf({ filter, query, phone }: ShelfProps) {
  const prefs = usePrefs(filter, query)
  const { entries, mine, loading } = useEntries()
  const manifestsById = useKitManifests((s) => s.manifests)
  const [kitsFailed, setKitsFailed] = useState(false)
  useEffect(() => { void loadBuiltinKits().then((list) => setKitsFailed(list.length === 0)) }, [])
  const manifests = useMemo(() => BUILTIN_KITS.map((id) => manifestsById[id]).filter((m): m is KitManifest => !!m), [manifestsById])
  const shelf = useMemo(() => wallShelf(entries, manifests, prefs, mine), [entries, manifests, prefs, mine])
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const tool = useBuildUi((s) => s.tool)
  const segment = useBuildUi((s) => s.segment)
  const held = useBuildUi((s) => (s.tool === 'place' ? s.held : null))
  const favourites = prefs.favourites
  const done = () => closePhoneSheet(phone)
  const total = shelf.invisible.length + shelf.models.length + shelf.kit.length
  return (
    <div className="lib-shelf lib-parts">
      <div className="lib-scroll">
        {total === 0 && <p className="muted small lib-empty">{emptyText(filter, query, loading)}</p>}
        <Section title="For map images" count={shelf.invisible.length}>
          {shelf.invisible.map((s) => (
            <Tile key={s.id} title={s.title} hint={`${s.title}: ${s.hint}`} icon={s.id}
              held={tool === 'segment' && segment === s.id} fav={favourites.includes(segmentRef(s.id))}
              onPick={() => { armSegmentTool(s.id); noteRecentlyPlaced(segmentRef(s.id)); done() }} onStar={() => toggleFavouriteModel(segmentRef(s.id))} />
          ))}
        </Section>
        <Section title="Walls, gates and doors" count={shelf.models.length}>
          {shelf.models.map(({ entry, parts }) => (
            <Tile key={entry.id} title={entry.title} hint={`${entry.title}: ${parts.door ? 'a door; click it on the table to open or close' : parts.wall?.blocks === 'both' ? 'blocks sight and movement' : 'blocks movement'}`}
              thumb={catalogueThumbnailUrl(entry)} held={held?.catalogue === entry.id} fav={favourites.includes(entry.id)}
              onPick={() => { pickUpModel(heldFromEntry(entry)); noteRecentlyPlaced(entry.id); done() }} onStar={() => toggleFavouriteModel(entry.id)} />
          ))}
        </Section>
        <Section title="Kit walls as props" count={shelf.kit.length}>
          {shelf.kit.map(({ piece, parts }) => {
            const entry = byId.get(piece.catalogue)
            return (
              <Tile key={piece.catalogue} title={piece.title} hint={`${piece.title}: placed as a prop (the Kit shelf paints it on the grid)`}
                thumb={entry ? catalogueThumbnailUrl(entry) : undefined} held={held?.catalogue === piece.catalogue} fav={favourites.includes(piece.catalogue)}
                onPick={() => { if (!entry) return; pickUpModel({ ...heldFromEntry(entry), fixtures: parts }); noteRecentlyPlaced(piece.catalogue); done() }}
                onStar={() => toggleFavouriteModel(piece.catalogue)} />
            )
          })}
        </Section>
        {kitsFailed && <p className="muted small">The kits could not be loaded.</p>}
      </div>
    </div>
  )
}
