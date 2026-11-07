import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PANELS } from '../panels/registry'
import { BUILD_FOLDS_KEY, normalizeMode, panelShown, readBuildFolds, routePanel, setTableMode, useTableLayout } from './tableLayout'
import { filterCommands, isPaletteKey, scoreCommand, type Command } from './commands'
import { useLibraryView } from '../library/libraryView'
import { useBuildUi } from '@/table/build/buildState'
import { useKitUi } from '@/table/kits/kitState'
import { useGame } from '@/state/store'
import type { TokenId } from '@/core/ids'

const reset = () => {
  useTableLayout.setState({ mode: 'play', card: null, scrollOpen: false, palette: false, bell: false, phone: null, buildLibraryOpen: true, buildInspectorOpen: true })
  useLibraryView.setState({ shelf: 'models', filter: 'all', query: '' })
  useBuildUi.setState({ tool: null })
  useKitUi.setState({ tool: null })
}

describe('panel routes', () => {
  it('chat is the scroll for everyone', () => {
    expect(routePanel('chat', true)).toEqual({ kind: 'scroll' })
    expect(routePanel('chat', false)).toEqual({ kind: 'scroll' })
  })

  it('players get every other panel as the one card', () => {
    for (const p of PANELS.filter((d) => d.scope === 'all' && d.id !== 'chat')) expect(routePanel(p.id, false)).toEqual({ kind: 'card', id: p.id })
  })

  it('the GM adds in the Build Library, edits the scene in the Build Inspector, and reads the rest as cards', () => {
    expect(routePanel('library', true)).toEqual({ kind: 'build', shelf: 'models' })
    expect(routePanel('kit', true)).toEqual({ kind: 'build', shelf: 'kit' })
    expect(routePanel('prep', true)).toEqual({ kind: 'build', shelf: 'creatures' })
    expect(routePanel('tokens', true)).toEqual({ kind: 'build', filter: 'in-scene' })
    expect(routePanel('build', true)).toEqual({ kind: 'build', inspector: 'scene' })
    for (const id of ['scenes', 'sound', 'players', 'journal', 'credits', 'skills-editor', 'character', 'skills', 'initiative', 'tables', 'npc', 'encounters', 'scene-switcher']) {
      expect(routePanel(id, true)).toEqual({ kind: 'card', id })
    }
  })

  it('every panel has a home, and none of them is a Prep leaf any more', () => {
    for (const p of PANELS) {
      expect(['scroll', 'card', 'build']).toContain(routePanel(p.id, true).kind)
      if (p.scope === 'all') expect(routePanel(p.id, false).kind).not.toBe('build')
    }
  })
})

describe('modes', () => {
  beforeEach(reset)

  it('has two modes; an old or stored Prep becomes Build', () => {
    expect(normalizeMode('prep')).toBe('build')
    expect(normalizeMode('build')).toBe('build')
    expect(normalizeMode('play')).toBe('play')
    expect(normalizeMode(undefined)).toBe('play')
    expect(normalizeMode('raised')).toBe('play')
    useTableLayout.getState().set({ mode: 'prep' as never })
    expect(useTableLayout.getState().mode).toBe('build')
    setTableMode('prep')
    expect(useTableLayout.getState().mode).toBe('build')
  })

  it('leaving Build puts the build and kit tools away', () => {
    setTableMode('build')
    useBuildUi.getState().set({ tool: 'kit' })
    useKitUi.getState().set({ tool: 'floor' })
    setTableMode('play')
    expect(useTableLayout.getState().mode).toBe('play')
    expect(useBuildUi.getState().tool).toBeNull()
    expect(useKitUi.getState().tool).toBeNull()
  })
})

describe('table layout store', () => {
  beforeEach(reset)

  it('opens the Library on the shelf a panel stands for', () => {
    const s = useTableLayout.getState()
    useTableLayout.setState({ buildLibraryOpen: false })
    s.open('prep', true)
    expect(useTableLayout.getState().mode).toBe('build')
    expect(useTableLayout.getState().buildLibraryOpen).toBe(true)
    expect(useLibraryView.getState().shelf).toBe('creatures')
    s.open('kit', true)
    expect(useLibraryView.getState().shelf).toBe('kit')
    expect(useLibraryView.getState().filter).toBe('all')
    s.open('tokens', true)
    expect(useLibraryView.getState().shelf).toBe('kit')
    expect(useLibraryView.getState().filter).toBe('in-scene')
    s.open('library', true)
    expect(useLibraryView.getState()).toMatchObject({ shelf: 'models', filter: 'all' })
  })

  it('opens Build with the Inspector on the scene: no tool, nothing selected', () => {
    useBuildUi.getState().set({ tool: 'wall' })
    useGame.getState().setSelectedToken('t1' as TokenId)
    useTableLayout.setState({ buildInspectorOpen: false })
    useTableLayout.getState().open('build', true)
    const s = useTableLayout.getState()
    expect(s.mode).toBe('build')
    expect(s.buildInspectorOpen).toBe(true)
    expect(useBuildUi.getState().tool).toBeNull()
    expect(useGame.getState().selectedToken).toBeNull()
  })

  it('keeps one card at a time, beside the scroll on wide screens', () => {
    const s = useTableLayout.getState()
    s.open('chat', true)
    s.open('journal', true)
    s.open('players', true)
    const now = useTableLayout.getState()
    expect(now.card).toBe('players')
    expect(now.scrollOpen).toBe(true)
    expect(panelShown(now, 'journal', true)).toBe(false)
    expect(panelShown(now, 'players', true)).toBe(true)
    expect(panelShown(now, 'chat', true)).toBe(true)
  })

  it('on phones every place is the one sheet, so opening one closes the others', () => {
    const s = useTableLayout.getState()
    s.open('chat', false, true)
    s.open('journal', false, true)
    expect(useTableLayout.getState().scrollOpen).toBe(false)
    expect(useTableLayout.getState().card).toBe('journal')
    s.open('library', true, true)
    let now = useTableLayout.getState()
    expect(now.mode).toBe('build')
    expect(now.phone).toBe('library')
    expect(now.card).toBeNull()
    s.open('build', true, true)
    now = useTableLayout.getState()
    expect(now.phone).toBe('inspector')
  })
})

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

describe('Build dock folds', () => {
  beforeEach(() => { reset(); vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the stored folds, defaulting to both docks open', () => {
    expect(readBuildFolds(null)).toEqual({ buildLibraryOpen: true, buildInspectorOpen: true })
    expect(readBuildFolds('not json')).toEqual({ buildLibraryOpen: true, buildInspectorOpen: true })
    expect(readBuildFolds('{"buildLibraryOpen":false}')).toEqual({ buildLibraryOpen: false, buildInspectorOpen: true })
    expect(readBuildFolds('{"buildLibraryOpen":1,"buildInspectorOpen":false}')).toEqual({ buildLibraryOpen: true, buildInspectorOpen: false })
  })

  it('remembers them per device', () => {
    useTableLayout.getState().set({ buildLibraryOpen: false })
    expect(readBuildFolds(localStorage.getItem(BUILD_FOLDS_KEY))).toEqual({ buildLibraryOpen: false, buildInspectorOpen: true })
    useTableLayout.getState().set({ buildInspectorOpen: false })
    expect(readBuildFolds(localStorage.getItem(BUILD_FOLDS_KEY))).toEqual({ buildLibraryOpen: false, buildInspectorOpen: false })
  })
})

describe('command palette search', () => {
  const noop = () => {}
  const cmds: Command[] = [
    { id: 'a', title: 'Open Journal', group: 'Open', words: 'handout notes', run: noop },
    { id: 'b', title: 'Roll 1d20', group: 'Dice', words: 'dice die', run: noop },
    { id: 'c', title: 'Draw walls', group: 'Build', words: 'line of sight', where: 'Build · tools', run: noop },
    { id: 'd', title: 'Journey onwards', group: 'Scenes', run: noop },
  ]

  it('needs every word somewhere, and ranks title prefixes first', () => {
    expect(filterCommands(cmds, 'jour').map((c) => c.id)).toEqual(['d', 'a'])
    expect(filterCommands(cmds, 'handout').map((c) => c.id)).toEqual(['a'])
    expect(filterCommands(cmds, 'walls sight').map((c) => c.id)).toEqual(['c'])
    expect(filterCommands(cmds, 'build').map((c) => c.id)).toEqual(['c'])
    expect(filterCommands(cmds, 'nothing here')).toEqual([])
  })

  it('ignores case and accents; an empty query matches everything', () => {
    expect(scoreCommand(cmds[1]!, 'ROLL')).not.toBeNull()
    expect(scoreCommand({ ...cmds[3]!, title: 'Café' }, 'cafe')).not.toBeNull()
    expect(filterCommands(cmds, '  ')).toHaveLength(4)
  })

  it('opens on Ctrl or Cmd with K, and nothing else', () => {
    const k = { key: 'k', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }
    expect(isPaletteKey(k)).toBe(true)
    expect(isPaletteKey({ ...k, ctrlKey: false, metaKey: true, key: 'K' })).toBe(true)
    expect(isPaletteKey({ ...k, shiftKey: true })).toBe(false)
    expect(isPaletteKey({ ...k, ctrlKey: false })).toBe(false)
  })
})
