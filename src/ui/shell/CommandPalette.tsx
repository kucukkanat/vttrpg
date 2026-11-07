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
import { toggleBuildTool, type BuildTool } from '@/table/build/buildState'
import { newSeed } from '@/dice'
import { undoLast } from '@/state/undo'
import { useRollMode } from '../rollMode'
import { pushToast } from '../toasts'
import { setTextScale, setThemePref } from '../theme/theme'
import { endCombat, startCombat } from '../panels/InitiativePanel'
import { requestInvite } from '../panels/TopBar'
import { focusChatInput, toggleShortcutsOverlay } from './useShortcuts'
import { useTableLayout } from './tableLayout'
import { setTableMode } from './TableChrome'
import { filterCommands, GROUP_ORDER, isPaletteKey, type Command, type CommandGroup } from './commands'
import { Icon } from '../icons'

export interface PaletteActions {
  openPanel(id: string): void
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
      const where = p.id === 'chat' ? 'The scroll' : p.id === 'build' ? 'GM screen · Build' : ['scenes', 'prep', 'tokens', 'skills-editor'].includes(p.id) && isGm ? 'GM screen · Prep' : 'Card'
      add('Open', { id: `open:${p.id}`, title: p.id === 'chat' ? 'Open the scroll (chat)' : `Open ${p.title}`, words: `${p.short} panel show`, where, run: () => actions.openPanel(p.id) })
    }
    add('Open', { id: 'chat:focus', title: 'Write in the scroll', words: 'chat say message whisper type', keys: '/', where: 'The scroll', run: () => { actions.openPanel('chat'); requestAnimationFrame(() => focusChatInput()) } })

    if (isGm) {
      add('GM screen', { id: 'mode:play', title: 'Play mode: fold the screen', words: 'mode', run: () => setTableMode('play') })
      add('GM screen', { id: 'mode:prep', title: 'Prep mode: raise the screen', words: 'mode scenes encounters cast creatures npc', run: () => setTableMode('prep') })
      add('GM screen', { id: 'mode:build', title: 'Build mode: the tool tray', words: 'mode walls doors fog lights props', run: () => setTableMode('build') })
      const tools: [BuildTool, string, string][] = [
        ['wall', 'Draw walls', 'line of sight'], ['door', 'Draw doors', 'open close lock'], ['erase', 'Erase walls and doors', 'delete remove'],
        ['fog-reveal', 'Reveal fog', 'brush paint explored'], ['fog-hide', 'Hide under fog', 'brush paint'], ['light', 'Place a light', 'lamp torch colour'],
      ]
      for (const [tool, title, words] of tools) {
        add('Build', { id: `build:${tool}`, title, words, where: 'GM screen · Build', run: () => { setTableMode('build'); useTableLayout.getState().set({ buildTab: 'build' }); toggleBuildTool(tool) } })
      }
      add('Build', { id: 'build:scene', title: 'Scene settings', words: 'darkness weather ambience fog grid', where: 'GM screen · Build', run: () => { setTableMode('build'); useTableLayout.getState().set({ buildTab: 'scenes' }) } })
      add('Build', { id: 'build:undo', title: 'Undo the last removal', words: 'restore', keys: 'Cmd/Ctrl+Z', run: () => void undoLast().then((e) => e && pushToast({ text: `Restored ${e.subject}`, ttl: 2500 })) })
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

/** Suggested with an empty query: what this moment most likely needs. */
function suggested(all: Command[], isGm: boolean, combat: boolean): Command[] {
  const ids = combat
    ? (isGm ? ['combat:next', 'combat:order', 'chat:focus', 'roll:1d20'] : ['combat:order', 'open:character', 'chat:focus', 'roll:1d20'])
    : (isGm ? ['combat:start', 'mode:prep', 'mode:build', 'game:invite'] : ['open:character', 'open:journal', 'chat:focus', 'roll:1d20'])
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
  const results = useMemo(() => {
    if (query.trim()) return filterCommands(all, query)
    const grouped = [...all].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
    return [...suggested(all, controller.connection.isGm, combat), ...grouped]
  }, [all, query, controller, combat])
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
