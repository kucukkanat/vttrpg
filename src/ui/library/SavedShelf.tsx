/**
 * The Library's Saved shelf: groups (prefabs: props and walls saved from a selection or captured)
 * and encounters (saved creature groups). Picking a card picks the whole group up; a click on the
 * board stamps it (savedPickup.ts). Each card renames and deletes in place.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PrefabId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import type { GameController } from '../controller'
import { useCompendium } from '../panels/CreaturesPrep'
import { Icon } from '../icons'
import { LibIcon } from './libraryIcons'
import { noteRecentlyPlaced, toggleFavouriteModel, useLibraryPrefs } from './libraryPrefs'
import type { LibraryFilter } from './libraryView'
import { PlaceVisibleToggle } from './CreatureShelf'
import { pickUpEncounter, pickUpGroup } from './savedPickup'
import { closePhoneSheet } from './sheet'
import { savedShelf, type SavedCard } from './shelves'

const MAX_NAME = 80

export default function SavedShelf({ controller, filter, query, phone }: { controller: GameController; filter: LibraryFilter; query: string; phone: boolean }) {
  const compendium = useCompendium(controller.rules)
  const prefabs = useGame((s) => s.prefabs)
  const encounters = useGame((s) => s.encounters)
  const templates = useGame((s) => s.creatures)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const recent = useLibraryPrefs((s) => s.recent)
  const favourites = useLibraryPrefs((s) => s.favourites)
  const tool = useBuildUi((s) => s.tool)
  const stamp = useBuildUi((s) => s.stamp)
  const heldTitle = useBuildUi((s) => (s.tool === 'creature' ? s.creatures?.title : undefined))
  const shelf = useMemo(
    () => savedShelf({ prefabs, encounters, compendium: compendium.creatures, templates }, { query, filter, recent, favourites }),
    [prefabs, encounters, compendium.creatures, templates, query, filter, recent, favourites],
  )
  if (!sceneId) return <p className="muted small lib-empty">Add a scene first.</p>
  const loading = compendium.status === 'loading'

  const pick = (c: SavedCard) => {
    if (c.kind === 'group') pickUpGroup(c.id as PrefabId)
    else if (!pickUpEncounter(controller, c.encounter, compendium.creatures)) return
    noteRecentlyPlaced(c.id)
    closePhoneSheet(phone)
  }
  const rename = (c: SavedCard, name: string) => {
    if (c.kind === 'group') void controller.dispatch({ type: 'prefab.upsert', prefab: { ...c.prefab, name } })
    else void controller.dispatch({ type: 'encounter.upsert', encounter: { ...c.encounter, name } })
  }
  const remove = (c: SavedCard) => {
    if (c.kind === 'group') {
      if (tool === 'prefab-stamp' && stamp?.prefab === c.id) useBuildUi.getState().set({ tool: null, stamp: null })
      void controller.dispatch({ type: 'prefab.remove', prefab: c.id as PrefabId })
    } else {
      void controller.dispatch({ type: 'encounter.remove', encounter: c.id })
    }
  }
  const held = (c: SavedCard) => (c.kind === 'group' ? tool === 'prefab-stamp' && stamp?.prefab === c.id : heldTitle === c.name)
  const card = (c: SavedCard) => (
    <SavedRow key={c.id} card={c} held={held(c)} fav={favourites.includes(c.id)} disabled={c.kind === 'encounter' && loading}
      onPick={() => pick(c)} onRename={(n) => rename(c, n)} onRemove={() => remove(c)} />
  )
  const noneAtAll = !Object.keys(prefabs).length && !Object.keys(encounters).length
  const filtered = filter === 'favourites' ? 'Star a group or encounter to keep it here.' : filter === 'recent' ? 'Groups and encounters you place show up here.' : null

  return (
    <div className="lib-shelf lib-saved">
      <div className="lib-scroll">
        {noneAtAll && (
          <p className="muted small lib-empty">
            Select props on the board and use Save as group in the Inspector; they land here to stamp anywhere. Encounters saved from the NPC generator show here too.
          </p>
        )}
        {!noneAtAll && !shelf.groups.length && !shelf.encounters.length && (
          <p className="muted small lib-empty">{!query && filtered ? filtered : `Nothing matches${query ? ` “${query}”` : ''}.`}</p>
        )}
        {shelf.groups.length > 0 && (
          <section className="lib-section">
            <h4 className="lib-section-title">Groups <span className="muted">· {shelf.groups.length}</span></h4>
            <p className="muted small lib-hint">Click the board to stamp; R turns a quarter; Esc puts it down.</p>
            <ul className="lib-rows">{shelf.groups.map(card)}</ul>
          </section>
        )}
        {shelf.encounters.length > 0 && (
          <section className="lib-section">
            <h4 className="lib-section-title">Encounters <span className="muted">· {shelf.encounters.length}</span></h4>
            <div className="lib-opts"><PlaceVisibleToggle /></div>
            <ul className="lib-rows">{shelf.encounters.map(card)}</ul>
          </section>
        )}
      </div>
    </div>
  )
}

type Mode = 'idle' | 'rename' | 'confirm'

function SavedRow({ card, held, fav, disabled, onPick, onRename, onRemove }: {
  card: SavedCard; held: boolean; fav: boolean; disabled: boolean; onPick(): void; onRename(name: string): void; onRemove(): void
}) {
  const [mode, setMode] = useState<Mode>('idle')
  const [name, setName] = useState(card.name)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { if (mode === 'rename') field.current?.select() }, [mode])
  useEffect(() => { setName(card.name) }, [card.name])
  if (mode === 'rename') {
    const save = () => {
      const n = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
      if (n && n !== card.name) onRename(n)
      setMode('idle')
    }
    return (
      <li className="lib-crit lib-crit--edit">
        <form className="lib-rename" onSubmit={(e) => { e.preventDefault(); save() }}>
          <input ref={field} value={name} maxLength={MAX_NAME} aria-label="New name" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setName(card.name); setMode('idle') } }} />
          <button type="submit" className="tiny">Save</button>
          <button type="button" className="tiny" onClick={() => { setName(card.name); setMode('idle') }}>Cancel</button>
        </form>
      </li>
    )
  }
  if (mode === 'confirm') {
    return (
      <li className="lib-crit lib-crit--edit">
        <span className="small lib-confirm">Delete {card.name}?{card.kind === 'encounter' ? ' Placed tokens stay.' : ' Stamped copies stay.'}</span>
        <button type="button" className="tiny danger" onClick={() => { setMode('idle'); onRemove() }}>Delete</button>
        <button type="button" className="tiny" onClick={() => setMode('idle')}>Keep</button>
      </li>
    )
  }
  return (
    <li className={`lib-crit${held ? ' held' : ''}`}>
      <button type="button" className="lib-crit-pick" aria-pressed={held} disabled={disabled} onClick={onPick}
        title={card.kind === 'group' ? `${card.name}: click to pick up, then click the board to stamp` : `${card.name}: click to pick up, then click the board to place`}>
        <span className={`lib-disc lib-disc--${card.kind}`} aria-hidden>{card.kind === 'group' ? <Icon name="cube" size={16} /> : <Icon name="swords" size={16} />}</span>
        <span className="lib-crit-text"><span className="lib-title">{card.name}</span><span className="lib-size">{disabled ? 'Loading stat blocks…' : card.meta}</span></span>
      </button>
      <button type="button" className="icon lib-row-act" aria-label={`Rename ${card.name}`} title="Rename" onClick={() => setMode('rename')}><Icon name="pencil" size={14} /></button>
      <button type="button" className="icon lib-row-act" aria-label={`Delete ${card.name}`} title="Delete" onClick={() => setMode('confirm')}><Icon name="trash" size={14} /></button>
      <button type="button" className={`lib-star lib-star--row${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? `Unstar ${card.name}` : `Star ${card.name}`}
        onClick={() => toggleFavouriteModel(card.id)}>
        <LibIcon name="star" size={14} />
      </button>
    </li>
  )
}
