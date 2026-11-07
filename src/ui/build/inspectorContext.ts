/**
 * What the GM's Inspector shows: one context at a time, or nothing. A selection wins over the
 * tool in hand; with nothing selected and no kit or creatures in hand there is no Inspector at all
 * (the scene's settings open from the scene title instead).
 */
import type { Selection } from '@/state/store'
import type { BuildTool } from '@/table/build/buildState'

export type InspectorContext =
  | { kind: 'prop' }
  | { kind: 'props'; count: number }
  | { kind: 'token' }
  /** A named part of the scene model, picked in edit mode. */
  | { kind: 'node' }
  /** A kit card is in hand: the paint options. */
  | { kind: 'paint' }
  /** Creatures from the Library in hand: where and how they land. */
  | { kind: 'creature' }

export interface InspectorInput {
  selection: Selection | null
  propCount: number
  selectedToken: string | null
  tool: BuildTool | null
}

export function inspectorContext({ selection, propCount, selectedToken, tool }: InspectorInput): InspectorContext | null {
  if (propCount > 1) return { kind: 'props', count: propCount }
  if (propCount === 1) return { kind: 'prop' }
  if (selectedToken || selection?.kind === 'token') return { kind: 'token' }
  if (selection?.kind === 'node') return { kind: 'node' }
  if (tool === 'kit') return { kind: 'paint' }
  if (tool === 'creature') return { kind: 'creature' }
  return null
}

/** The Inspector's heading for a context. */
export function contextTitle(c: InspectorContext): string {
  switch (c.kind) {
    case 'prop': return 'Prop'
    case 'props': return `${c.count} props`
    case 'token': return 'Token'
    case 'node': return 'Scene part'
    case 'paint': return 'Paint'
    case 'creature': return 'Placing creatures'
  }
}
