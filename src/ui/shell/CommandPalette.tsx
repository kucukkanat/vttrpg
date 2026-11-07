/**
 * The command palette (Ctrl/⌘-K, or Search in the top bar): one search over every action, panel,
 * token and scene, so anything the table layout keeps out of sight is one search away. Arrows move,
 * Enter runs, Esc closes. The list is built here from the live state; matching is commands.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import { toggleBuildTool } from '@/table/build/buildState'
import type { CatalogueEntry } from '@/core/catalogue'
import { searchCatalogue } from '../catalogue'
import { pickUpEntry, useBuiltinCatalogue, useMyModels } from '../library/useCatalogue'
import { newSeed } from '@/dice'
import { describeOutcome, redoLast, undoLast } from '@/state/undo'
import { useRollMode } from '../rollMode'
import { pushToast } from '../toasts'
import { setTextScale, setThemePref } from '../theme/theme'
import { endCombat, startCombat } from '../panels/InitiativePanel'
import { requestInvite } from '../panels/TopBar'
import { focusChatInput, toggleShortcutsOverlay } from './useShortcuts'
import { openLibrary, routePanel, useTableLayout } from './tableLayout'
import { useEditMode } from './editMode'
import { LIBRARY_SHELVES, useLibraryView, type LibraryFilter, type LibraryShelf } from '../library/libraryView'
import { openDrawerCard } from './GmDrawer'
import { filterCommands, GROUP_ORDER, isPaletteKey, type Command, type CommandGroup } from './commands'
import { Icon } from '../icons'

/** Panels the GM drawer holds (they open as the one card). */
const DRAWER_PANELS = new Set(['sound', 'players', 'journal', 'tables', 'npc', 'encounters', 'credits', 'scene-switcher'])

/** Old names that should still find a panel ("prep", "cast", "build" from before one mode). */
const PANEL_ALIASES: Record<string, string> = {
  encounters: 'prep fight ambush run',
  npc: 'prep generator cast',
  tables: 'prep random oracle',
  tokens: 'cast',
  'skills-editor': 'cast',
  'scene-switcher': 'scenes go live switch settings darkness weather grid',
  library: 'build prep encounters',
}

export interface PaletteActions {
  openPanel(id: string): void
  /** The layout is the phone's (the Library opens as a sheet). */
  phone: boolean
  zen(): void
  display(): void
  compact(on: boolean): void
  exportGame?(): void
  leave(): void
}

function useCommands(controller: GameController, panels: PanelDef[], actions: PaletteActions): Command[] {
  const tokens = useGame((s) => s.tokens)
  const scenes = useGame((s) => s.scenes)
  const active = useGame((s) => s.meta?.activeScene ?? null)
  const combat = useGame((s) => !!s.initiative?.active)
  const isGm = controller.connection.isGm
  return useMemo(() => {
    const ui = () => useTableUi.getState()
    const roll = (formula: string) => void controller.dispatch({ type: 'roll', formula, seed: newSeed() })
    const list: Command[] = []
    const add = (group: CommandGroup, c: Omit<Command, 'group'>) => list.push({ ...c, group })

    // Open: every panel, wherever it lives.
    for (const p of panels) {
      const route = routePanel(p.id, isGm)
      const drawer = isGm && DRAWER_PANELS.has(p.id)
      const where = route.kind === 'scroll' ? 'The scroll' : route.kind === 'library' ? 'Library' : drawer ? 'GM drawer' : p.id === 'scene-switcher' ? 'Scene title' : 'Card'
      // Drawer items open as the one card in Play.
      const open = drawer ? () => openDrawerCard(p.id) : () => actions.openPanel(p.id)
      add('Open', { id: `open:${p.id}`, title: p.id === 'chat' ? 'Open the scroll (chat)' : `Open ${p.title}`, words: `${p.short} panel show ${PANEL_ALIASES[p.id] ?? ''}`, where, run: open })
    }
    add('Open', { id: 'chat:focus', title: 'Write in the scroll', words: 'chat say message whisper type', keys: '/', where: 'The scroll', run: () => { actions.openPanel('chat'); requestAnimationFrame(() => focusChatInput()) } })

    if (isGm) {
      add('GM screen', { id: 'drawer:tables', title: 'Roll on a random table', words: 'tables random oracle prep', where: 'GM drawer', run: () => openDrawerCard('tables') })
      add('GM screen', { id: 'drawer:npc', title: 'New NPC', words: 'npc generator name stat block creature prep cast', where: 'GM drawer', run: () => openDrawerCard('npc') })
      add('GM screen', { id: 'drawer:encounters', title: 'Run an encounter', words: 'encounters run fight ambush creatures prep place', where: 'GM drawer', run: () => openDrawerCard('encounters') })
      add('GM screen', { id: 'drawer:fog', title: 'Fog brush: reveal', words: 'fog of war reveal paint brush explored', where: 'Tool rail', run: () => toggleBuildTool('fog-reveal') })
      add('GM screen', { id: 'drawer:fog-hide', title: 'Fog brush: hide', words: 'fog of war hide cover paint brush', where: 'Tool rail', run: () => toggleBuildTool('fog-hide') })
      add('GM screen', { id: 'scene:card', title: 'Scene settings', words: 'darkness weather ambience fog grid display credits map rename add scene switch', where: 'Scene title', run: () => actions.openPanel('scene-switcher') })

      // The Library: open it, jump to a shelf, and the Edit toggle. "build", "prep" and "encounters" still find it.
      const shelf = (s: LibraryShelf, filter: LibraryFilter = 'all') => () => openLibrary(actions.phone, s, filter)
      add('Library', { id: 'library:open', title: 'Open Library', words: 'build prep encounters add place props models stamp', where: 'Library', run: () => openLibrary(actions.phone) })
      add('Library', { id: 'library:edit', title: 'Toggle editing', words: 'edit pencil lock unlock move props walls doors lights build', where: 'Library · pencil', run: () => useEditMode.getState().toggle() })
      const words: Partial<Record<LibraryShelf, string>> = {
        models: 'props models place stamp furniture assets build',
        kit: 'floors walls doors stairs roofs grid kit paint build',
        creatures: 'npc monsters stat blocks prep encounters cast',
        saved: 'prefabs groups encounters stamp prep',
      }
      for (const sh of LIBRARY_SHELVES) {
        add('Library', { id: `library:${sh.id}`, title: `Library: ${sh.label}`, words: words[sh.id] ?? sh.label, where: 'Library', run: shelf(sh.id) })
      }
      add('Library', { id: 'library:in-scene', title: 'What is in this scene', words: 'tokens props lights outliner cast list', where: 'Library', run: () => openLibrary(actions.phone, undefined, 'in-scene') })
      add('Library', { id: 'library:eyedropper', title: 'Eyedropper: pick a prop’s model up', words: 'same again copy model', keys: 'Alt+click', where: 'Library', run: () => toggleBuildTool('eyedropper') })
      add('Library', { id: 'build:undo', title: 'Undo your last edit', words: 'restore removal move', keys: 'Cmd/Ctrl+Z', run: () => void undoLast().then((o) => o && pushToast({ text: describeOutcome(o, 'undo'), ttl: 2500 })) })
      add('Library', { id: 'build:redo', title: 'Redo', words: 'again repeat', keys: 'Cmd/Ctrl+Shift+Z', run: () => void redoLast().then((o) => o && pushToast({ text: describeOutcome(o, 'redo'), ttl: 2500 })) })
    }

    // Table tools.
    add('Table', { id: 'cam:eyes', title: 'Look through the token’s eyes', words: 'first person camera view', keys: 'F', where: 'Tool rail', run: () => ui().set({ firstPerson: !ui().firstPerson }) })
    add('Table', { id: 'cam:top', title: 'Top-down view', words: 'tactical camera map', keys: 'T', where: 'Tool rail', run: () => ui().set({ tactical: !ui().tactical, firstPerson: false }) })
    add('Table', { id: 'cam:grid', title: 'Show or hide the grid', words: 'squares cells', keys: 'G', where: 'Tool rail', run: () => ui().set({ showGrid: !ui().showGrid }) })
    add('Table', { id: 'tool:ruler', title: 'Measure with the ruler', words: 'distance range', keys: 'M', where: 'Tool rail', run: () => ui().set({ tool: ui().tool === 'ruler' ? null : 'ruler' }) })
    add('Table', { id: 'tool:ping', title: 'Ping a spot for everyone', words: 'mark look here', where: 'Tool rail', run: () => ui().set({ tool: ui().tool === 'ping' ? null : 'ping' }) })
    add('Table', { id: 'tool:select', title: 'Select several tokens', words: 'multi select group', where: 'Tool rail', run: () => ui().set({ multiSelect: !ui().multiSelect }) })
    add('Table', { id: 'view:zen', title: 'Zen: hide everything over the table', words: 'hide ui chrome clean', keys: 'Z', run: actions.zen })
    add('Table', { id: 'view:display', title: 'Display mode for a shared screen', words: 'tv projector presentation', run: actions.display })
    add('Table', { id: 'view:compact', title: 'Compact layout (phone arrangement)', words: 'small narrow tabs', run: () => actions.compact(true) })
    add('Table', { id: 'view:standard', title: 'Standard layout', words: 'table desktop', run: () => actions.compact(false) })

    // Dice.
    for (const f of ['1d20', '2d6', '1d8', '1d6', '1d4', '1d100']) add('Dice', { id: `roll:${f}`, title: `Roll ${f}`, words: 'dice die', where: 'Dice well', run: () => roll(f) })
    add('Dice', { id: 'mode:adv', title: 'Next d20 with advantage', words: 'adv roll mode', where: 'The scroll · seal', run: () => useRollMode.getState().setAdvantage('advantage') })
    add('Dice', { id: 'mode:dis', title: 'Next d20 with disadvantage', words: 'dis roll mode', where: 'The scroll · seal', run: () => useRollMode.getState().setAdvantage('disadvantage') })
    add('Dice', { id: 'vis:public', title: 'Rolls: everyone sees', words: 'visibility public roll mode', where: 'The scroll · seal', run: () => useRollMode.getState().setVisibility('public') })
    add('Dice', { id: 'vis:gm', title: 'Rolls: GM only', words: 'visibility private hidden roll mode', where: 'The scroll · seal', run: () => useRollMode.getState().setVisibility('gm') })
    add('Dice', { id: 'vis:blind', title: 'Rolls: blind', words: 'visibility secret roll mode', where: 'The scroll · seal', run: () => useRollMode.getState().setVisibility('blind') })

    // Combat.
    if (isGm && !combat) add('Combat', { id: 'combat:start', title: 'Roll initiative and start combat', words: 'fight encounter initiative', where: 'Top bar', run: () => void startCombat(controller) })
    if (isGm && combat) {
      add('Combat', { id: 'combat:next', title: 'Next turn', words: 'initiative advance', where: 'Top bar', run: () => void controller.dispatch({ type: 'initiative.next' }) })
      add('Combat', { id: 'combat:end', title: 'End combat', words: 'initiative stop summary', where: 'Top bar', run: () => endCombat(controller) })
    }
    add('Combat', { id: 'combat:order', title: 'Turn order', words: 'initiative tracker standees', where: 'Standees', run: () => actions.openPanel('initiative') })

    // Tokens on the live scene: select and frame.
    for (const t of Object.values(tokens)) {
      if (t.scene !== active || (t.hidden && !isGm)) continue
      add('Tokens', {
        id: `token:${t.id}`, title: t.name, words: 'token find select centre', where: t.owner === controller.pubkey ? 'Yours' : undefined,
        run: () => { useGame.getState().setSelectedToken(t.id); ui().focusToken(t.id) },
      })
    }

    // Scenes (GM): make one live.
    if (isGm) {
      for (const sc of Object.values(scenes)) {
        if (sc.id === active) continue
        add('Scenes', { id: `scene:${sc.id}`, title: `Go to ${sc.name}`, words: 'scene switch live map', run: () => void controller.dispatch({ type: 'scene.activate', scene: sc.id }) })
      }
    }

    // Game.
    if (isGm) add('Game', { id: 'game:invite', title: 'Invite players', words: 'link share join', where: 'Top bar', run: requestInvite })
    if (actions.exportGame) add('Game', { id: 'game:export', title: 'Export the game file', words: 'save backup download', run: actions.exportGame })
    add('Game', { id: 'game:credits', title: 'Scene credits', words: 'licence attribution authors models cc by', where: isGm ? 'GM drawer' : 'Card', run: () => (isGm ? openDrawerCard('credits') : actions.openPanel('credits')) })
    add('Game', { id: 'game:keys', title: 'Keyboard shortcuts', words: 'keys help', keys: '?', run: () => toggleShortcutsOverlay(true) })
    add('Game', { id: 'theme:dark', title: 'Theme: lamplight (dark)', words: 'appearance colour', run: () => setThemePref('dark') })
    add('Game', { id: 'theme:daylight', title: 'Theme: parchment (light)', words: 'appearance colour bright daylight', run: () => setThemePref('daylight') })
    add('Game', { id: 'theme:system', title: 'Theme: follow the system', words: 'appearance colour auto', run: () => setThemePref('system') })
    add('Game', { id: 'text:default', title: 'Text size: default', words: 'font accessibility', run: () => setTextScale('default') })
    add('Game', { id: 'text:large', title: 'Text size: large', words: 'font accessibility bigger', run: () => setTextScale('large') })
    add('Game', { id: 'text:larger', title: 'Text size: larger', words: 'font accessibility biggest', run: () => setTextScale('larger') })
    add('Game', { id: 'game:leave', title: 'Leave the game', words: 'exit quit home', run: actions.leave })
    return list
  }, [controller, panels, actions, tokens, scenes, active, combat, isGm])
}

/** Most library models one search lists. */
const MAX_MODEL_RESULTS = 6

/** GM: library models matching the query; running one picks the model up (and turns editing on). */
function useLibraryCommands(isGm: boolean, query: string): Command[] {
  const builtin = useBuiltinCatalogue(isGm)
  const mine = useMyModels()
  return useMemo(() => {
    if (!isGm || query.trim().length < 2) return []
    const pool: CatalogueEntry[] = [...mine, ...(builtin ?? [])]
    return searchCatalogue(pool, query).slice(0, MAX_MODEL_RESULTS).map((e) => ({
      id: `model:${e.id}`, group: 'Library' as const, title: `Place ${e.title}`, where: e.kit ? 'Library · kit' : 'Library',
      run: () => { useLibraryView.getState().set({ shelf: e.kit ? 'kit' : 'models' }); pickUpEntry(e) },
    }))
  }, [isGm, query, builtin, mine])
}

/** Suggested with an empty query: what this moment most likely needs. */
function suggested(all: Command[], isGm: boolean, combat: boolean): Command[] {
  const ids = combat
    ? (isGm ? ['combat:next', 'combat:order', 'chat:focus', 'roll:1d20'] : ['combat:order', 'open:character', 'chat:focus', 'roll:1d20'])
    : (isGm ? ['combat:start', 'drawer:encounters', 'library:open', 'game:invite'] : ['open:character', 'open:journal', 'chat:focus', 'roll:1d20'])
  return ids.map((id) => all.find((c) => c.id === id)).filter((c): c is Command => !!c).map((c) => ({ ...c, group: 'Suggested' as const }))
}

export function CommandPalette({ controller, panels, actions }: { controller: GameController; panels: PanelDef[]; actions: PaletteActions }) {
  const open = useTableLayout((s) => s.palette)
  const set = useTableLayout((s) => s.set)
  // Ctrl/⌘-K anywhere toggles it.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!isPaletteKey(e)) return
      e.preventDefault()
      set({ palette: !useTableLayout.getState().palette })
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [set])
  if (!open) return null
  return <PaletteDialog controller={controller} panels={panels} actions={actions} onClose={() => set({ palette: false })} />
}

function PaletteDialog({ controller, panels, actions, onClose }: { controller: GameController; panels: PanelDef[]; actions: PaletteActions; onClose(): void }) {
  const all = useCommands(controller, panels, actions)
  const combat = useGame((s) => !!s.initiative?.active)
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const models = useLibraryCommands(controller.connection.isGm, query)
  const results = useMemo(() => {
    if (query.trim()) return [...filterCommands(all, query), ...models]
    const grouped = [...all].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
    return [...suggested(all, controller.connection.isGm, combat), ...grouped]
  }, [all, query, controller, combat, models])
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setAt(0) }, [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at])
  const run = (c: Command | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[at]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }
  let lastGroup: CommandGroup | null = null
  return (
    <div className="t-palette-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="t-palette skin-paper" role="dialog" aria-label="Search everything" onKeyDown={onKey}>
        <div className="t-palette-field">
          <Icon name="search" />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actions, panels, tokens, scenes…"
            aria-label="Search everything" role="combobox" aria-expanded aria-controls="t-palette-list" aria-activedescendant={results[at] ? `t-cmd-${at}` : undefined}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <kbd className="key-hint">Esc</kbd>
        </div>
        <ul className="t-palette-list" id="t-palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <li className="t-palette-empty muted small">Nothing matches “{query}”.</li>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <li key={`${c.group}:${c.id}`} role="presentation">
                {head && <div className="t-palette-group" role="presentation">{head}</div>}
                <button type="button" id={`t-cmd-${i}`} data-i={i} role="option" aria-selected={i === at} className={`t-palette-item${i === at ? ' on' : ''}`}
                  onPointerMove={() => setAt(i)} onClick={() => run(c)}>
                  <span className="t-palette-title">{c.title}</span>
                  {c.where && <span className="t-palette-where">{c.where}</span>}
                  {c.keys && <kbd className="key-hint">{c.keys}</kbd>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
