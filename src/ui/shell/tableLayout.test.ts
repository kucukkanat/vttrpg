import { beforeEach, describe, expect, it } from 'vitest'
import { PANELS } from '../panels/registry'
import { DEFAULT_LEAF_TABS, LEAVES, panelShown, routePanel, useTableLayout } from './tableLayout'
import { filterCommands, isPaletteKey, scoreCommand, type Command } from './commands'

const reset = () => useTableLayout.setState({ mode: 'play', card: null, leafTabs: { ...DEFAULT_LEAF_TABS }, leaf: 'world', buildTab: 'build', scrollOpen: false, palette: false, bell: false, phone: null })

describe('panel routes', () => {
  it('chat is the scroll for everyone', () => {
    expect(routePanel('chat', true)).toEqual({ kind: 'scroll' })
    expect(routePanel('chat', false)).toEqual({ kind: 'scroll' })
  })

  it('players get every other panel as the one card', () => {
    for (const p of PANELS.filter((d) => d.scope === 'all' && d.id !== 'chat')) expect(routePanel(p.id, false)).toEqual({ kind: 'card', id: p.id })
  })

  it('the GM authors in Prep and Build, and reads the table panels as cards', () => {
    expect(routePanel('build', true)).toEqual({ kind: 'build', tab: 'build' })
    expect(routePanel('scenes', true)).toEqual({ kind: 'prep', leaf: 'world', tab: 'scenes' })
    expect(routePanel('prep', true)).toEqual({ kind: 'prep', leaf: 'world', tab: 'prep' })
    expect(routePanel('tokens', true)).toEqual({ kind: 'prep', leaf: 'cast', tab: 'tokens' })
    expect(routePanel('skills-editor', true)).toEqual({ kind: 'prep', leaf: 'cast', tab: 'skills-editor' })
    for (const id of ['character', 'skills', 'initiative', 'journal', 'players', 'sound']) expect(routePanel(id, true)).toEqual({ kind: 'card', id })
  })

  it('scene credits live in the Reference leaf for the GM and stay a card for players', () => {
    expect(LEAVES.find((l) => l.id === 'reference')?.panels).toContain('credits')
    expect(routePanel('credits', true)).toEqual({ kind: 'prep', leaf: 'reference', tab: 'credits' })
    expect(routePanel('credits', false)).toEqual({ kind: 'card', id: 'credits' })
  })

  it('every leaf and tab names a real panel, and every panel has a home', () => {
    const ids = new Set(PANELS.map((p) => p.id))
    for (const leaf of LEAVES) for (const id of leaf.panels) expect(ids.has(id), id).toBe(true)
    for (const p of PANELS) {
      expect(routePanel(p.id, true)).toBeTruthy()
      if (p.scope === 'all') expect(routePanel(p.id, false)).toBeTruthy()
    }
  })
})

describe('table layout store', () => {
  beforeEach(reset)

  it('opens a GM authoring panel by switching mode and picking its tab', () => {
    useTableLayout.getState().open('skills-editor', true)
    const s = useTableLayout.getState()
    expect(s.mode).toBe('prep')
    expect(s.leaf).toBe('cast')
    expect(s.leafTabs.cast).toBe('skills-editor')
    expect(panelShown(s, 'skills-editor', true, false)).toBe(true)
    expect(panelShown(s, 'tokens', true, false)).toBe(false)
  })

  it('keeps one card at a time, beside the scroll on wide screens', () => {
    const s = useTableLayout.getState()
    s.open('chat', true)
    s.open('journal', true)
    s.open('players', true)
    const now = useTableLayout.getState()
    expect(now.card).toBe('players')
    expect(now.scrollOpen).toBe(true)
    expect(panelShown(now, 'journal', true, false)).toBe(false)
  })

  it('on phones every place is the one sheet, so opening one closes the others', () => {
    const s = useTableLayout.getState()
    s.open('chat', false, true)
    s.open('journal', false, true)
    expect(useTableLayout.getState().scrollOpen).toBe(false)
    expect(useTableLayout.getState().card).toBe('journal')
    s.open('build', true, true)
    const now = useTableLayout.getState()
    expect(now.mode).toBe('build')
    expect(now.phone).toBe('screen')
    expect(now.card).toBeNull()
  })
})

describe('command palette search', () => {
  const noop = () => {}
  const cmds: Command[] = [
    { id: 'a', title: 'Open Journal', group: 'Open', words: 'handout notes', run: noop },
    { id: 'b', title: 'Roll 1d20', group: 'Dice', words: 'dice die', run: noop },
    { id: 'c', title: 'Draw walls', group: 'Build', words: 'line of sight', where: 'GM screen · Build', run: noop },
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
