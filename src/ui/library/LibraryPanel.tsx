/**
 * The Library: everything the GM can add, behind one search (reports/Play and Build plan.md,
 * phase 4). Four shelves (`useLibraryView`): Models (the prop catalogue: pick up and stamp), Kit
 * (grid kit pieces: a card arms the kit paint tool), Creatures (the compendium and the game's stat
 * blocks: pick up and place as tokens, hidden by default) and Saved (groups and encounters: pick
 * up and stamp the whole group). The filter chips (Recent, Favourites, In this scene, My models)
 * apply to the active shelf; "In this scene" is the scene's outliner.
 *
 * The Build workspace hosts this panel and may draw the shelf switcher itself (`bare`).
 *
 * Model cards: clicking picks the model up (`pickUpEntry`) and the table's `PlaceLayer` stamps it;
 * cards can also be dragged onto the board. The grid is windowed, so 300+ cards scroll smoothly.
 */
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import type { GameController } from '../controller'
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import { useGame } from '@/state/store'
import { putDownModel, toggleBuildTool, useBuildUi } from '@/table/build/buildState'
import { MAX_SCATTER_RANGE, SNAP_CHOICES } from '@/table/build/placement'
import { catalogueCategories } from '../catalogue'
import { Icon } from '../icons'
import { LibIcon } from './libraryIcons'
import { useBreakpoint } from '../shell/useBreakpoint'
import { closePhoneSheet } from './sheet'
import { pushToast } from '../toasts'
import { DEFAULT_CELL_M, libraryResults, licenceBadge, MAX_TITLE, placedCopies, removalNote, renamedEntry, sceneCatalogueIds, sizeBadge } from './libraryLogic'
import { AssetStatusBadge } from '../AssetStatusBadge'
import { toggleFavouriteModel, useLibraryPrefs } from './libraryPrefs'
import { LIBRARY_SHELVES, useLibraryView, type LibraryFilter, type LibraryShelf } from './libraryView'
import { modelShelfFor } from './shelves'
import { heldFromEntry, pickUpEntry, useBuiltinCatalogue, useMyModels, useThumbnail } from './useCatalogue'
import './LibraryPanel.css'

const ImportDialog = lazy(() => import('../import/ImportDialog'))
const HoverPreview = lazy(() => import('./HoverPreview'))
const KitShelf = lazy(() => import('./KitShelf'))
const CreatureShelf = lazy(() => import('./CreatureShelf'))
const SavedShelf = lazy(() => import('./SavedShelf'))
const Outliner = lazy(() => import('./Outliner'))

/** Hover this long before the 3D preview appears. */
const PREVIEW_DELAY_MS = 400
const CARD_MIN_W = 104
const CARD_TEXT_H = 46
const GAP = 8

const snapLabel = (c: number) => (c === 0 ? 'Free' : c === 0.25 ? '¼ cell' : c === 0.5 ? '½ cell' : `${c} cell`)

const SEARCH_HINT: Record<LibraryShelf, string> = {
  models: 'Search models and tags',
  kit: 'Search kit pieces',
  creatures: 'Search creatures (goblin, undead…)',
  saved: 'Search groups and encounters',
}

/** The filter chips a shelf offers ('mine' reads per shelf; kits and saved groups have no imports). */
export function filtersFor(shelf: LibraryShelf): { id: LibraryFilter; label: string }[] {
  const base: { id: LibraryFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'recent', label: 'Recent' }, { id: 'favourites', label: 'Favourites' }, { id: 'in-scene', label: 'In this scene' },
  ]
  if (shelf === 'models') base.push({ id: 'mine', label: 'My models' })
  if (shelf === 'creatures') base.push({ id: 'mine', label: 'This game' })
  return base
}

export function LibraryPanel({ controller, bare = false }: {
  controller: GameController
  /** The host draws the shelf switcher (the Build workspace's Library dock). */
  bare?: boolean
}) {
  const shelf = useLibraryView((s) => s.shelf)
  const filter = useLibraryView((s) => s.filter)
  const query = useLibraryView((s) => s.query)
  const setView = useLibraryView((s) => s.set)
  const phone = useBreakpoint() === 'phone'
  const [importing, setImporting] = useState(false)
  const firstPick = useRef<(() => void) | null>(null)

  if (!controller.connection.isGm) return <div className="panel"><p className="muted small">The GM places models.</p></div>

  const filters = filtersFor(shelf)
  const activeFilter = filters.some((f) => f.id === filter) ? filter : 'all'
  const onImported = (entry: CatalogueEntry) => {
    setImporting(false)
    void controller.dispatch({ type: 'catalogue.add', entry })
    setView({ shelf: 'models', filter: 'mine' })
    pickUpEntry(entry)
    pushToast({ text: `${entry.title} is in My models; click the board to place it`, ttl: 3500 })
  }

  return (
    <div className="panel library-panel" data-shelf={shelf}>
      <div className="lib-top">
        <label className="lib-search">
          <Icon name="search" size={16} />
          <input type="search" value={query} onChange={(e) => setView({ query: e.target.value })} placeholder={activeFilter === 'in-scene' ? 'Search this scene' : SEARCH_HINT[shelf]}
            aria-label="Search the library" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') firstPick.current?.() }} />
        </label>
        {!phone && shelf === 'models' && (
          <button type="button" className="tiny" onClick={() => setImporting(true)} title="Upload a model, or import from Poly Haven or Sketchfab">
            <Icon name="plus" size={14} /> Import…
          </button>
        )}
      </div>
      {!bare && (
        <div className="lib-chips lib-shelfbar" role="tablist" aria-label="Shelf">
          {LIBRARY_SHELVES.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={shelf === s.id} className={`lib-tab${shelf === s.id ? ' on' : ''}`}
              onClick={() => setView({ shelf: s.id })}>{s.label}</button>
          ))}
        </div>
      )}
      <div className="lib-chips lib-shelves" role="group" aria-label="Filter">
        {filters.map((f) => (
          <button key={f.id} type="button" aria-pressed={activeFilter === f.id} className={`lib-chip${activeFilter === f.id ? ' on' : ''}`} onClick={() => setView({ filter: f.id })}>
            {f.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<p className="muted small lib-empty">Loading…</p>}>
        {activeFilter === 'in-scene'
          ? <Outliner controller={controller} query={query} />
          : shelf === 'models' ? <ModelsShelf controller={controller} filter={activeFilter} query={query} phone={phone} firstPick={firstPick} />
            : shelf === 'kit' ? <KitShelf filter={activeFilter} query={query} phone={phone} />
              : shelf === 'creatures' ? <CreatureShelf controller={controller} filter={activeFilter} query={query} phone={phone} />
                : <SavedShelf controller={controller} filter={activeFilter} query={query} phone={phone} />}
      </Suspense>
      {importing && (
        <Suspense fallback={null}>
          <ImportDialog open onClose={() => setImporting(false)} onImported={onImported} assets={controller.assets} />
        </Suspense>
      )}
    </div>
  )
}

/** The Models shelf: category chips, placement options and the windowed card grid. */
function ModelsShelf({ controller, filter, query, phone, firstPick }: {
  controller: GameController; filter: LibraryFilter; query: string; phone: boolean; firstPick: MutableRefObject<(() => void) | null>
}) {
  const builtin = useBuiltinCatalogue()
  const mine = useMyModels()
  const recent = useLibraryPrefs((s) => s.recent)
  const favourites = useLibraryPrefs((s) => s.favourites)
  const props = useGame((s) => s.props)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const cell = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene]?.grid.cellSize : undefined)) ?? DEFAULT_CELL_M
  const [category, setCategory] = useState<string | null>(null)
  const shelf = modelShelfFor(filter)
  const scene = useMemo(() => sceneCatalogueIds(props, sceneId), [props, sceneId])
  const src = useMemo(() => ({ builtin: builtin ?? [], mine, recent, favourites, scene }), [builtin, mine, recent, favourites, scene])
  const results = useMemo(() => libraryResults(src, { shelf, query, category, kit: false }), [src, shelf, query, category])
  const categories = useMemo(() => catalogueCategories([...mine, ...(builtin ?? [])].filter((e) => !e.kit)), [builtin, mine])
  const resolve = useCallback((ref: AssetRef) => controller.assets.resolve(ref), [controller])
  const manage = useMemo<Manage>(() => ({
    rename: (e, title) => {
      const next = renamedEntry(e, title)
      if (next) void controller.dispatch({ type: 'catalogue.add', entry: next })
    },
    remove: (e) => {
      void controller.dispatch({ type: 'catalogue.remove', id: e.id })
      if (useBuildUi.getState().held?.catalogue === e.id) putDownModel()
      pushToast({ text: `${e.title} is no longer in My models`, ttl: 2500 })
    },
  }), [controller])
  const pick = (e: CatalogueEntry) => {
    pickUpEntry(e)
    // On a phone the sheet covers the board: put it away so the next tap places.
    closePhoneSheet(phone)
  }
  useEffect(() => { firstPick.current = results[0] ? () => pick(results[0]!) : null })
  const emptyText = builtin === null ? 'Loading the library…'
    : shelf === 'recent' && !query ? 'Models you place show up here.'
      : shelf === 'favourites' && !query ? 'Star a card to keep it here.'
        : shelf === 'mine' && !mine.length ? 'Import a model (Upload, Poly Haven, Sketchfab) and it lands here for every GM of this game.'
          : `Nothing matches${query ? ` “${query}”` : ''}.`
  return (
    <>
      <div className="lib-chips lib-cats" role="group" aria-label="Category">
        <button type="button" className={`lib-chip lib-chip--cat${!category ? ' on' : ''}`} aria-pressed={!category} onClick={() => setCategory(null)}>Any</button>
        {categories.map((c) => (
          <button key={c.category} type="button" aria-pressed={category === c.category} className={`lib-chip lib-chip--cat${category === c.category ? ' on' : ''}`}
            onClick={() => setCategory(category === c.category ? null : c.category)}>{c.category}</button>
        ))}
      </div>
      <PlacementOptions phone={phone} />
      {results.length === 0
        ? <p className="muted small lib-empty">{emptyText}</p>
        : <CardGrid entries={results} cell={cell} resolve={resolve} onPick={pick} phone={phone} favourites={favourites} mine={mine} manage={manage} />}
    </>
  )
}

/** Snap, scatter and the eyedropper, under the chips. */
function PlacementOptions({ phone }: { phone: boolean }) {
  const snapCells = useBuildUi((s) => s.snapCells)
  const scatter = useBuildUi((s) => s.scatter)
  const range = useBuildUi((s) => s.scatterRange)
  const tool = useBuildUi((s) => s.tool)
  const set = useBuildUi((s) => s.set)
  return (
    <div className="lib-opts" role="group" aria-label="Placement">
      <label className="lib-opt" title="Snap step (hold Alt for free placement)">
        <span className="muted small">Snap</span>
        <select value={snapCells} onChange={(e) => set({ snapCells: Number(e.target.value) })} aria-label="Snap step">
          {SNAP_CHOICES.map((c) => <option key={c} value={c}>{snapLabel(c)}</option>)}
        </select>
      </label>
      <label className="check lib-opt" title="Each stamp gets a random turn and size">
        <input type="checkbox" checked={scatter} onChange={(e) => {
          const on = e.target.checked
          set({ scatter: on, roll: on ? { yaw: Math.random() * Math.PI * 2, scale: 1 - range + Math.random() * 2 * range } : { yaw: 0, scale: 1 } })
        }} />
        Scatter
      </label>
      {scatter && (
        <label className="lib-opt lib-range" title="Scale range of scattered stamps">
          <span className="muted small">±{Math.round(range * 100)}%</span>
          <input type="range" min={0} max={MAX_SCATTER_RANGE} step={0.05} value={range} onChange={(e) => set({ scatterRange: Number(e.target.value) })} aria-label="Scatter scale range" />
        </label>
      )}
      {!phone && (
        <button type="button" className={`icon lib-dropper${tool === 'eyedropper' ? ' on' : ''}`} aria-pressed={tool === 'eyedropper'}
          title="Eyedropper: click a prop on the board to pick its model up again (or Alt-click any prop)" aria-label="Eyedropper"
          onClick={() => (tool === 'eyedropper' ? putDownModel() : toggleBuildTool('eyedropper'))}>
          <LibIcon name="dropper" size={18} />
        </button>
      )}
    </div>
  )
}

/** What a My models card's menu does. */
interface Manage {
  rename(e: CatalogueEntry, title: string): void
  remove(e: CatalogueEntry): void
}

interface GridProps {
  mine: CatalogueEntry[]
  manage: Manage
  entries: CatalogueEntry[]
  cell: number
  resolve(ref: AssetRef): Promise<string>
  onPick(e: CatalogueEntry): void
  phone: boolean
  favourites: string[]
}

/** The cards, windowed: only the rows in view (plus one each side) are in the DOM. */
function CardGrid({ entries, cell, resolve, onPick, phone, favourites, mine, manage }: GridProps) {
  const mineIds = useMemo(() => new Set(mine.map((e) => e.id)), [mine])
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [height, setHeight] = useState(400)
  const [top, setTop] = useState(0)
  const heldId = useBuildUi((s) => (s.tool === 'place' ? s.held?.catalogue : undefined))
  const [preview, setPreview] = useState<{ entry: CatalogueEntry; rect: DOMRect } | null>(null)
  const [previewMounted, setPreviewMounted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canHover = useMemo(() => !phone && typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches, [phone])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => { setWidth(el.clientWidth); setHeight(el.clientHeight) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // A new search starts at the top.
  useEffect(() => { box.current?.scrollTo?.({ top: 0 }); setTop(0) }, [entries])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const cols = Math.max(2, Math.floor((width + GAP) / (CARD_MIN_W + GAP)))
  const cardW = (width - GAP * (cols - 1)) / cols
  const rowH = cardW + CARD_TEXT_H + GAP
  const rows = Math.ceil(entries.length / cols)
  const first = Math.max(0, Math.floor(top / rowH) - 1)
  const last = Math.min(rows - 1, Math.ceil((top + height) / rowH) + 1)
  const shown: Array<{ e: CatalogueEntry; i: number }> = []
  for (let r = first; r <= last; r++) for (let c = 0; c < cols; c++) { const i = r * cols + c; if (i < entries.length) shown.push({ e: entries[i]!, i }) }

  const hoverStart = (e: CatalogueEntry, el: HTMLElement) => {
    if (!canHover) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // Beside the tray (not over the cards), level with the hovered card.
      const card = el.getBoundingClientRect()
      const side = (el.closest('.t-tray') ?? box.current ?? el).getBoundingClientRect()
      setPreviewMounted(true)
      setPreview({ entry: e, rect: new DOMRect(side.left, card.top, side.width, card.height) })
    }, PREVIEW_DELAY_MS)
  }
  const hoverEnd = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setPreview(null)
  }

  return (
    <div className="lib-grid" ref={box} onScroll={(e) => setTop(e.currentTarget.scrollTop)} onPointerLeave={hoverEnd}>
      <div className="lib-grid-inner" style={{ height: rows * rowH - GAP }}>
        {shown.map(({ e, i }) => (
          <Card key={e.id} entry={e} cell={cell} resolve={resolve} onPick={onPick} draggable={!phone} fav={favourites.includes(e.id)} held={heldId === e.id}
            manage={mineIds.has(e.id) ? manage : undefined}
            style={{ left: (i % cols) * (cardW + GAP), top: Math.floor(i / cols) * rowH, width: cardW, height: cardW + CARD_TEXT_H }}
            onHover={hoverStart} onLeave={hoverEnd} />
        ))}
      </div>
      {previewMounted && (
        <Suspense fallback={null}>
          <HoverPreview entry={preview?.entry ?? null} anchor={preview?.rect ?? null} resolve={resolve} />
        </Suspense>
      )}
    </div>
  )
}

const Card = memo(function Card({ entry, cell, resolve, onPick, draggable, fav, held, style, onHover, onLeave, manage }: {
  entry: CatalogueEntry; cell: number; resolve(ref: AssetRef): Promise<string>; onPick(e: CatalogueEntry): void
  draggable: boolean; fav: boolean; held: boolean; style: CSSProperties
  onHover(e: CatalogueEntry, el: HTMLElement): void; onLeave(): void
  /** My models only: the card menu (Rename, Remove from library) and the upload status. */
  manage?: Manage | undefined
}) {
  const thumb = useThumbnail(entry, resolve)
  const licence = licenceBadge(entry)
  const size = sizeBadge(entry.size, cell)
  const [menu, setMenu] = useState<CardMenu>('closed')
  if (manage && menu !== 'closed') return <ManageCard entry={entry} style={style} menu={menu} setMenu={setMenu} manage={manage} />
  return (
    <div className={`lib-card${held ? ' held' : ''}`} style={style}
      onPointerEnter={(ev) => { if (ev.pointerType === 'mouse') onHover(entry, ev.currentTarget) }} onPointerLeave={onLeave}>
      <button type="button" className="lib-card-pick" onClick={() => onPick(entry)} aria-pressed={held}
        title={`${entry.title}: ${size}${licence ? ` · ${licence}` : ''}. Click to pick up, then click the board to place`}
        draggable={draggable}
        onDragStart={(ev) => {
          ev.dataTransfer.setData('text/plain', entry.title)
          ev.dataTransfer.effectAllowed = 'copy'
          onLeave()
          useBuildUi.getState().set({ dragging: heldFromEntry(entry) })
        }}
        onDragEnd={() => useBuildUi.getState().set({ dragging: null })}>
        <span className="lib-thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" draggable={false} /> : <Icon name="cube" size={28} />}
          {licence && <span className="lib-badge lib-badge--licence">{licence}</span>}
        </span>
        <span className="lib-title">{entry.title}</span>
        <span className="lib-size">{size}</span>
      </button>
      <button type="button" className={`lib-star${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? `Unstar ${entry.title}` : `Star ${entry.title}`}
        title={fav ? 'Remove from Favourites' : 'Add to Favourites'} onClick={() => toggleFavouriteModel(entry.id)}>
        <LibIcon name="star" size={14} />
      </button>
      {manage && (
        <>
          <button type="button" className="lib-more" aria-label={`${entry.title}: rename or remove`} title="Rename or remove from library"
            aria-haspopup="menu" onClick={() => { onLeave(); setMenu('open') }}>
            <LibIcon name="more" size={14} />
          </button>
          <span className="lib-status"><AssetStatusBadge sha256={entry.model.sha256} /></span>
        </>
      )}
    </div>
  )
})

type CardMenu = 'closed' | 'open' | 'rename' | 'confirm'

/** A My models card turned over: its menu, the rename field or the inline remove confirmation. */
export function ManageCard({ entry, style, menu, setMenu, manage }: {
  entry: CatalogueEntry; style: CSSProperties; menu: Exclude<CardMenu, 'closed'>; setMenu(m: CardMenu): void; manage: Manage
}) {
  const [title, setTitle] = useState(entry.title)
  const first = useRef<HTMLButtonElement | HTMLInputElement | null>(null)
  useEffect(() => { first.current?.focus() }, [menu])
  const close = () => setMenu('closed')
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  return (
    <div className="lib-card lib-card--manage" style={style} onKeyDown={onKey}>
      <div className="lib-manage" role={menu === 'open' ? 'menu' : 'group'} aria-label={entry.title}>
        <strong className="lib-manage-title">{entry.title}</strong>
        {menu === 'open' && (
          <>
            <button type="button" role="menuitem" className="tiny" ref={(el) => { first.current = el }} onClick={() => setMenu('rename')}>Rename</button>
            <button type="button" role="menuitem" className="tiny danger" onClick={() => setMenu('confirm')}>Remove from library</button>
            <button type="button" role="menuitem" className="tiny" onClick={close}>Cancel</button>
          </>
        )}
        {menu === 'rename' && (
          <form onSubmit={(e) => { e.preventDefault(); manage.rename(entry, title); close() }}>
            <input value={title} maxLength={MAX_TITLE} aria-label="New name" ref={(el) => { first.current = el }}
              onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
            <div className="lib-manage-row">
              <button type="submit" className="tiny" disabled={!renamedEntry(entry, title)}>Save</button>
              <button type="button" className="tiny" onClick={close}>Cancel</button>
            </div>
          </form>
        )}
        {menu === 'confirm' && (
          <>
            <span className="small">Remove from library?</span>
            <span className="small muted">{removalNote(placedCopies(useGame.getState().props, entry.id))}</span>
            <div className="lib-manage-row">
              <button type="button" className="tiny danger" ref={(el) => { first.current = el }} onClick={() => { manage.remove(entry); close() }}>Remove</button>
              <button type="button" className="tiny" onClick={close}>Keep</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default LibraryPanel
