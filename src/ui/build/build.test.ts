import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Selection } from '@/state/store'
import type { PropId, TokenId } from '@/core/ids'
import { contextTitle, inspectorContext } from './inspectorContext'
import { FOLDS_KEY, readFolds, useFolds } from './folds'

describe('inspector context', () => {
  const none = { selection: null, propCount: 0, selectedToken: null, tool: null }
  const prop: Selection = { kind: 'prop', id: 'p1' as PropId }
  const token: Selection = { kind: 'token', id: 't1' as TokenId }

  it('shows nothing when nothing is selected and no kit piece or creatures are in hand', () => {
    expect(inspectorContext(none)).toBeNull()
    expect(inspectorContext({ ...none, tool: 'place' })).toBeNull()
    expect(inspectorContext({ ...none, tool: 'fog-reveal' })).toBeNull()
    expect(inspectorContext({ ...none, selection: { kind: 'scene', id: 's' as never } })).toBeNull()
  })

  it('shows the paint options with a kit piece in hand, and the creature options with creatures', () => {
    expect(inspectorContext({ ...none, tool: 'kit' })).toEqual({ kind: 'paint' })
    expect(inspectorContext({ ...none, tool: 'creature' })).toEqual({ kind: 'creature' })
  })

  it('puts a selection before the tool', () => {
    expect(inspectorContext({ ...none, selection: prop, propCount: 1, tool: 'kit' })).toEqual({ kind: 'prop' })
    expect(inspectorContext({ ...none, selection: prop, propCount: 3, tool: 'creature' })).toEqual({ kind: 'props', count: 3 })
    expect(inspectorContext({ ...none, selection: token, selectedToken: 't1', tool: 'kit' })).toEqual({ kind: 'token' })
    expect(inspectorContext({ ...none, selection: { kind: 'node', id: 'Door_01' } })).toEqual({ kind: 'node' })
  })

  it('names each context', () => {
    expect(contextTitle({ kind: 'props', count: 4 })).toBe('4 props')
    expect(contextTitle({ kind: 'paint' })).toBe('Paint')
    expect(contextTitle({ kind: 'token' })).toBe('Token')
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
