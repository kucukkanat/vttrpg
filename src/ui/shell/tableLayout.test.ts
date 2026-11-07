import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PANELS } from '../panels/registry'
import { LIBRARY_DOCK_KEY, openLibrary, panelShown, readLibraryOpen, routePanel, useTableLayout } from './tableLayout'
import { EDIT_MODE_KEY, readEditMode, useEditMode } from './editMode'
import { filterCommands, isPaletteKey, scoreCommand, type Command } from './commands'
import { useLibraryView } from '../library/libraryView'
import { closePhoneSheet } from '../library/sheet'
import { useBuildUi } from '@/table/build/buildState'
import { useKitUi } from '@/table/kits/kitState'
import { useTableUi } from '@/table/tableState'
import { useGame } from '@/state/store'
import type { PropId, TokenId } from '@/core/ids'

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

const reset = () => {
  useTableLayout.setState({ card: null, scrollOpen: false, palette: false, bell: false, phone: null, libraryOpen: false })
  useLibraryView.setState({ shelf: 'models', filter: 'all', query: '' })
  useBuildUi.setState({ tool: null })
  useKitUi.setState({ tool: null })
  useEditMode.setState({ on: false })
}

describe('panel routes', () => {
  it('chat is the scroll for everyone', () => {
    expect(routePanel('chat', true)).toEqual({ kind: 'scroll' })
    expect(routePanel('chat', false)).toEqual({ kind: 'scroll' })
  })

  it('players get every other panel as the one card', () => {
    for (const p of PANELS.filter((d) => d.scope === 'all' && d.id !== 'chat')) expect(routePanel(p.id, false)).toEqual({ kind: 'card', id: p.id })
  })

  it('the GM adds from the Library dock and reads the rest as cards', () => {
    expect(routePanel('library', true)).toEqual({ kind: 'library', shelf: 'models' })
    expect(routePanel('kit', true)).toEqual({ kind: 'library', shelf: 'kit' })
    expect(routePanel('prep', true)).toEqual({ kind: 'library', shelf: 'creatures' })
    expect(routePanel('tokens', true)).toEqual({ kind: 'library', filter: 'in-scene' })
    expect(routePanel('build', true)).toEqual({ kind: 'library' })
    for (const id of ['scenes', 'sound', 'players', 'journal', 'credits', 'skills-editor', 'character', 'skills', 'initiative', 'tables', 'npc', 'encounters', 'scene-switcher']) {
      expect(routePanel(id, true)).toEqual({ kind: 'card', id })
    }
  })

  it('every panel has a home, and players never get the Library dock', () => {
    for (const p of PANELS) {
      expect(['scroll', 'card', 'library']).toContain(routePanel(p.id, true).kind)
      if (p.scope === 'all') expect(routePanel(p.id, false).kind).not.toBe('library')
    }
  })
})

describe('table layout store', () => {
  beforeEach(reset)

  it('opens the Library dock on the shelf a panel stands for', () => {
    const s = useTableLayout.getState()
    s.open('prep', true)
    expect(useTableLayout.getState().libraryOpen).toBe(true)
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

  it('opens the old Build as the Library as it stands, and leaves the card alone', () => {
    useLibraryView.setState({ shelf: 'saved', filter: 'recent' })
    useTableLayout.setState({ card: 'journal' })
    useTableLayout.getState().open('build', true)
    expect(useTableLayout.getState()).toMatchObject({ libraryOpen: true, card: 'journal' })
    expect(useLibraryView.getState()).toMatchObject({ shelf: 'saved', filter: 'recent' })
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
    const now = useTableLayout.getState()
    expect(now.phone).toBe('library')
    expect(now.card).toBeNull()
    expect(now.libraryOpen).toBe(false)
    openLibrary(true, 'creatures')
    expect(useLibraryView.getState().shelf).toBe('creatures')
  })
})

describe('Library dock', () => {
  beforeEach(() => { reset(); vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('starts folded, and reads anything unreadable as folded', () => {
    expect(readLibraryOpen(null)).toBe(false)
    expect(readLibraryOpen('not json')).toBe(false)
    expect(readLibraryOpen('{"open":1}')).toBe(false)
    expect(readLibraryOpen('{"open":true}')).toBe(true)
  })

  it('remembers open or folded per device', () => {
    useTableLayout.getState().set({ libraryOpen: true })
    expect(readLibraryOpen(localStorage.getItem(LIBRARY_DOCK_KEY))).toBe(true)
    useTableLayout.getState().set({ libraryOpen: false })
    expect(readLibraryOpen(localStorage.getItem(LIBRARY_DOCK_KEY))).toBe(false)
  })
})

describe('Edit toggle', () => {
  beforeEach(() => { reset(); vi.stubGlobal('localStorage', memoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('is off on a first visit and remembered per device', () => {
    expect(readEditMode(null)).toBe(false)
    expect(readEditMode('nope')).toBe(false)
    expect(readEditMode('true')).toBe(true)
    useEditMode.getState().toggle()
    expect(useEditMode.getState().on).toBe(true)
    expect(readEditMode(localStorage.getItem(EDIT_MODE_KEY))).toBe(true)
  })

  it('turns on when a Library card is picked, or a Library tool comes out', () => {
    closePhoneSheet(false)
    expect(useEditMode.getState().on).toBe(true)
    useEditMode.getState().set(false)
    useBuildUi.getState().set({ tool: 'kit' })
    expect(useEditMode.getState().on).toBe(true)
    useEditMode.getState().set(false)
    useBuildUi.getState().set({ tool: 'fog-reveal' })
    expect(useEditMode.getState().on).toBe(false)
  })

  it('turning it off lets go of props and of what came from the Library; tokens stay selected', () => {
    useEditMode.getState().set(true)
    useGame.getState().setPropSelection(['p1' as PropId])
    useBuildUi.getState().set({ tool: 'place' })
    useKitUi.getState().set({ tool: 'floor' })
    useTableUi.getState().set({ editMode: true })
    useEditMode.getState().set(false)
    expect(useGame.getState().propSelection).toEqual([])
    expect(useBuildUi.getState().tool).toBeNull()
    expect(useKitUi.getState().tool).toBeNull()
    expect(useTableUi.getState().editMode).toBe(false)
    useGame.getState().setSelectedToken('t1' as TokenId)
    useEditMode.getState().set(true)
    useEditMode.getState().set(false)
    expect(useGame.getState().selectedToken).toBe('t1')
  })

  it('leaves the fog brush alone', () => {
    useEditMode.getState().set(true)
    useBuildUi.getState().set({ tool: 'fog-hide' })
    useEditMode.getState().set(false)
    expect(useBuildUi.getState().tool).toBe('fog-hide')
  })
})

describe('command palette search', () => {
  const noop = () => {}
  const cmds: Command[] = [
    { id: 'a', title: 'Open Journal', group: 'Open', words: 'handout notes', run: noop },
    { id: 'b', title: 'Roll 1d20', group: 'Dice', words: 'dice die', run: noop },
    { id: 'c', title: 'Draw walls', group: 'Library', words: 'line of sight build', where: 'Library', run: noop },
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
