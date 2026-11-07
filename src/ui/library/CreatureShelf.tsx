/**
 * The Library's Creatures shelf: the game's own stat blocks and the rules pack compendium, plus a
 * New NPC… card that opens the NPC generator inline. Picking a creature picks it up like a model:
 * a ghost of its token follows the cursor and a click places it as a token, hidden unless "Place
 * visible" is on. Placing goes through `placeRows`, so every token gets its own sheet copy, hit
 * points and action skills. "Edit stat block" opens the stat block editor as a card.
 */
import { useMemo, useState } from 'react'
import { useGame } from '@/state/store'
import { pickUpCreatures } from '@/table/build/creaturePickup'
import { useBuildUi } from '@/table/build/buildState'
import type { GameController } from '../controller'
import { Attribution, ensureTemplate, StatBlockEditor, useCompendium } from '../panels/CreaturesPrep'
import { ENCOUNTER_COLORS, newRow } from '../prep/encounters'
import { NpcGenerator } from '../prep/NpcGenerator'
import { placeRows } from '../prep/placeCreatures'
import { pushToast } from '../toasts'
import { LibIcon } from './libraryIcons'
import { noteRecentlyPlaced, toggleFavouriteModel, useLibraryPrefs } from './libraryPrefs'
import type { LibraryFilter } from './libraryView'
import { closePhoneSheet } from './sheet'
import { creatureShelf, type CreatureCard } from './shelves'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

/** "Place visible" for creatures and encounters picked from the Library (off: placed hidden). */
export function PlaceVisibleToggle() {
  const visible = useBuildUi((s) => s.placeVisible)
  return (
    <label className="check lib-opt" title="Off: creatures land hidden and the GM reveals them. On: players see them at once">
      <input type="checkbox" checked={visible} onChange={(e) => useBuildUi.getState().set({ placeVisible: e.target.checked })} />
      Place visible
    </label>
  )
}

export default function CreatureShelf({ controller, filter, query, phone }: { controller: GameController; filter: LibraryFilter; query: string; phone: boolean }) {
  const rules = controller.rules
  const compendium = useCompendium(rules)
  const templates = useGame((s) => s.creatures)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const recent = useLibraryPrefs((s) => s.recent)
  const favourites = useLibraryPrefs((s) => s.favourites)
  const heldRef = useBuildUi((s) => (s.tool === 'creature' ? s.creatures?.title : undefined))
  const visible = useBuildUi((s) => s.placeVisible)
  const [npc, setNpc] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { cards, total } = useMemo(
    () => creatureShelf({ templates, compendium: compendium.creatures }, { query, filter, recent, favourites }),
    [templates, compendium.creatures, query, filter, recent, favourites],
  )

  if (!sceneId) return <p className="muted small lib-empty">Add a scene first.</p>

  const pick = (c: CreatureCard) => {
    const color = ENCOUNTER_COLORS[Object.keys(useGame.getState().tokens).length % ENCOUNTER_COLORS.length]!
    pickUpCreatures({
      title: c.name,
      tokens: [{ name: c.name, color }],
      place: async (at, hidden) => {
        try {
          const s = useGame.getState()
          const row = newRow(Object.keys(s.tokens).length, { creatureRef: c.ref })
          const { missing } = await placeRows(controller, [row], compendium.creatures, s.creatures, { at, hidden })
          if (missing.length) pushToast({ text: `${c.name}: stat block not found` })
          noteRecentlyPlaced(c.ref)
        } catch (e) {
          pushToast({ text: `Place failed: ${e instanceof Error ? e.message : String(e)}` })
        }
      },
    })
    closePhoneSheet(phone)
  }
  const edit = async (ref: string) => {
    setBusy(true)
    try {
      const id = await ensureTemplate(controller, ref, compendium)
      if (id) setEditing(id)
    } finally { setBusy(false) }
  }

  if (editing && rules) {
    return (
      <div className="lib-scroll lib-shelf">
        <StatBlockEditor controller={controller} templateId={editing} compendium={compendium} onClose={() => setEditing(null)} />
      </div>
    )
  }

  const empty = compendium.status === 'loading' ? 'Loading the compendium…'
    : compendium.status === 'error' ? `Could not load creatures: ${compendium.error ?? ''}`
      : filter === 'favourites' && !query ? 'Star a creature to keep it here.'
        : filter === 'recent' && !query ? 'Creatures you place show up here.'
          : filter === 'mine' && !query ? "Edit a stat block (or make a homebrew one) and it is kept here for this game."
            : compendium.status === 'none' && !Object.keys(templates).length ? 'This rules pack has no creature compendium; use New NPC… for quick minis.'
              : `Nothing matches${query ? ` “${query}”` : ''}.`

  return (
    <div className="lib-shelf lib-creatures">
      <div className="lib-opts" role="group" aria-label="Placing creatures">
        <PlaceVisibleToggle />
        <span className="muted small">{visible ? 'Players see them at once' : 'Hidden until you reveal them'}</span>
      </div>
      <div className="lib-scroll">
        <ul className="lib-rows">
          <li className={`lib-crit lib-crit--new${npc ? ' open' : ''}`}>
            <button type="button" className="lib-crit-pick" aria-expanded={npc} onClick={() => setNpc(!npc)}>
              <span className="lib-disc lib-disc--new" aria-hidden>+</span>
              <span className="lib-crit-text"><span className="lib-title">New NPC…</span><span className="lib-size">Name, roll or pick a stat block, place hidden</span></span>
            </button>
          </li>
          {npc && (
            <li className="lib-npc">
              <NpcGenerator controller={controller} disabled={!sceneId} compendium={compendium} />
            </li>
          )}
          {cards.map((c) => {
            const fav = favourites.includes(c.ref)
            return (
              <li key={c.ref} className={`lib-crit${heldRef === c.name ? ' held' : ''}`}>
                <button type="button" className="lib-crit-pick" title={`${c.name}: click to pick up, then click the board to place`} onClick={() => pick(c)}>
                  <span className="lib-disc" aria-hidden>{initials(c.name)}</span>
                  <span className="lib-crit-text"><span className="lib-title">{c.name}</span><span className="lib-size">{c.meta}</span></span>
                </button>
                {rules && (
                  <button type="button" className="tiny lib-crit-edit" disabled={busy} onClick={() => void edit(c.ref)}
                    title={c.custom ? "Edit this game's stat block" : 'Copy into this game and edit (reskins, homebrew)'}>Edit stat block</button>
                )}
                <button type="button" className={`lib-star lib-star--row${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? `Unstar ${c.name}` : `Star ${c.name}`}
                  onClick={() => toggleFavouriteModel(c.ref)}>
                  <LibIcon name="star" size={14} />
                </button>
              </li>
            )
          })}
        </ul>
        {cards.length === 0 && <p className="muted small lib-empty">{empty}</p>}
        {total > cards.length && <p className="muted small">Showing {cards.length} of {total}; type more to narrow it down.</p>}
        <Attribution documents={compendium.documents} />
      </div>
    </div>
  )
}
