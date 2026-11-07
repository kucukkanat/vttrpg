import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Selection } from '@/state/store'
import type { PropId, TokenId } from '@/core/ids'
import { useBuildUi } from '@/table/build/buildState'
import { useKitUi } from '@/table/kits/kitState'
import { pickStripTool, STRIP_TOOLS, stripToolForKey, stripToolOf } from './buildTools'
import { contextTitle, inspectorContext } from './inspectorContext'
import { FOLDS_KEY, readFolds, useFolds } from './folds'

const reset = () => {
  useBuildUi.setState({ tool: null })
  useKitUi.setState({ tool: null })
}

describe('tool strip', () => {
  beforeEach(reset)

  it('has at most seven tools, each with its own key; Fog avoids F (first person) and G (grid)', () => {
    expect(STRIP_TOOLS.length).toBeLessThanOrEqual(7)
    expect(STRIP_TOOLS.map((t) => t.key)).toEqual(['V', 'P', 'W', 'L', 'B'])
    expect(new Set(STRIP_TOOLS.map((t) => t.key)).size).toBe(STRIP_TOOLS.length)
    for (const taken of ['F', 'G', 'T', 'M', 'Q', 'E', 'R', 'A', 'X', 'Y', 'Z']) expect(STRIP_TOOLS.some((t) => t.key === taken), taken).toBe(false)
  })

  it('maps keys to tools: plain letters only, Paint left out on phones', () => {
    expect(stripToolForKey({ key: 'v' })).toBe('select')
    expect(stripToolForKey({ key: 'P' })).toBe('paint')
    expect(stripToolForKey({ key: 'w' })).toBe('walls')
    expect(stripToolForKey({ key: 'l' })).toBe('light')
    expect(stripToolForKey({ key: 'b' })).toBe('fog')
    expect(stripToolForKey({ key: 'v', metaKey: true })).toBeNull()
    expect(stripToolForKey({ key: 'v', ctrlKey: true })).toBeNull()
    expect(stripToolForKey({ key: 'w', shiftKey: true })).toBeNull()
    expect(stripToolForKey({ key: 'f' })).toBeNull()
    expect(stripToolForKey({ key: 'Escape' })).toBeNull()
    expect(stripToolForKey({ key: 'p' }, true)).toBeNull()
  })

  it('reads every build tool as one strip tool', () => {
    expect(stripToolOf(null)).toBe('select')
    expect(stripToolOf('place')).toBe('select')
    expect(stripToolOf('prefab-stamp')).toBe('select')
    expect(stripToolOf('kit')).toBe('paint')
    expect(stripToolOf('door')).toBe('walls')
    expect(stripToolOf('erase')).toBe('walls')
    expect(stripToolOf('light')).toBe('light')
    expect(stripToolOf('fog-hide')).toBe('fog')
  })

  it('sets the existing build state, and the active tool again goes back to Select', () => {
    pickStripTool('walls')
    expect(useBuildUi.getState().tool).toBe('wall')
    pickStripTool('paint')
    expect(useBuildUi.getState().tool).toBe('kit')
    expect(useKitUi.getState().tool).toBe('floor')
    pickStripTool('fog')
    expect(useBuildUi.getState().tool).toBe('fog-reveal')
    expect(useKitUi.getState().tool).toBeNull()
    pickStripTool('fog')
    expect(useBuildUi.getState().tool).toBeNull()
    pickStripTool('light')
    pickStripTool('select')
    expect(useBuildUi.getState().tool).toBeNull()
  })

  it('brings a tool back with the sub-tool used last', () => {
    useBuildUi.getState().set({ tool: 'door' })
    pickStripTool('select')
    pickStripTool('walls')
    expect(useBuildUi.getState().tool).toBe('door')
    useBuildUi.getState().set({ tool: 'fog-hide' })
    pickStripTool('light')
    pickStripTool('fog')
    expect(useBuildUi.getState().tool).toBe('fog-hide')
  })
})

describe('inspector context', () => {
  const none = { selection: null, propCount: 0, selectedToken: null, tool: null }
  const prop: Selection = { kind: 'prop', id: 'p1' as PropId }
  const token: Selection = { kind: 'token', id: 't1' as TokenId }

  it('shows the scene when nothing is selected and no tool is out', () => {
    expect(inspectorContext(none)).toEqual({ kind: 'scene' })
    expect(inspectorContext({ ...none, tool: 'place' })).toEqual({ kind: 'scene' })
  })

  it('shows the tool’s options while a tool is out', () => {
    expect(inspectorContext({ ...none, tool: 'wall' })).toEqual({ kind: 'tool', tool: 'walls' })
    expect(inspectorContext({ ...none, tool: 'kit' })).toEqual({ kind: 'tool', tool: 'paint' })
    expect(inspectorContext({ ...none, tool: 'fog-reveal' })).toEqual({ kind: 'tool', tool: 'fog' })
    expect(inspectorContext({ ...none, tool: 'light' })).toEqual({ kind: 'tool', tool: 'light' })
  })

  it('puts a selection before the tool', () => {
    expect(inspectorContext({ ...none, selection: prop, propCount: 1, tool: 'wall' })).toEqual({ kind: 'prop' })
    expect(inspectorContext({ ...none, selection: prop, propCount: 3, tool: 'light' })).toEqual({ kind: 'props', count: 3 })
    expect(inspectorContext({ ...none, selection: token, selectedToken: 't1', tool: 'fog-hide' })).toEqual({ kind: 'token' })
    expect(inspectorContext({ ...none, selection: { kind: 'node', id: 'Door_01' } })).toEqual({ kind: 'node' })
    expect(inspectorContext({ ...none, selection: { kind: 'scene', id: 's' as never } })).toEqual({ kind: 'scene' })
  })

  it('names each context', () => {
    expect(contextTitle({ kind: 'props', count: 4 })).toBe('4 props')
    expect(contextTitle({ kind: 'tool', tool: 'walls' })).toBe('Walls')
    expect(contextTitle({ kind: 'scene' })).toBe('Scene')
  })
})

describe('inspector folds', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    useFolds.setState({ open: {} })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('starts folded and remembers each section per device', () => {
    expect(useFolds.getState().open['scene.grid']).toBeUndefined()
    useFolds.getState().setOpen('scene.grid', true)
    useFolds.getState().setOpen('token.vision', true)
    useFolds.getState().setOpen('token.vision', false)
    expect(readFolds(store.get(FOLDS_KEY) ?? null)).toEqual({ 'scene.grid': true, 'token.vision': false })
  })

  it('reads anything unreadable as all folded', () => {
    expect(readFolds(null)).toEqual({})
    expect(readFolds('nope')).toEqual({})
    expect(readFolds('[1,2]')).toEqual({})
    expect(readFolds('{"a":true,"b":"yes"}')).toEqual({ a: true })
  })
})
