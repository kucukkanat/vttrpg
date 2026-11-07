/**
 * What the Build Inspector shows: one context at a time. A selection wins over the active tool,
 * and the tool over the scene, which shows when nothing is selected and no tool is out.
 */
import type { Selection } from '@/state/store'
import type { BuildTool } from '@/table/build/buildState'
import { stripToolOf, type StripTool } from './buildTools'

export type InspectorContext =
  | { kind: 'prop' }
  | { kind: 'props'; count: number }
  | { kind: 'token' }
  /** A named part of the scene model, picked in edit mode. */
  | { kind: 'node' }
  | { kind: 'tool'; tool: Exclude<StripTool, 'select'> }
  | { kind: 'scene' }

export interface InspectorInput {
  selection: Selection | null
  propCount: number
  selectedToken: string | null
  tool: BuildTool | null
}

export function inspectorContext({ selection, propCount, selectedToken, tool }: InspectorInput): InspectorContext {
  if (propCount > 1) return { kind: 'props', count: propCount }
  if (propCount === 1) return { kind: 'prop' }
  if (selectedToken || selection?.kind === 'token') return { kind: 'token' }
  if (selection?.kind === 'node') return { kind: 'node' }
  const strip = stripToolOf(tool)
  if (strip !== 'select') return { kind: 'tool', tool: strip }
  return { kind: 'scene' }
}

/** The Inspector's heading for a context. */
export function contextTitle(c: InspectorContext): string {
  switch (c.kind) {
    case 'prop': return 'Prop'
    case 'props': return `${c.count} props`
    case 'token': return 'Token'
    case 'node': return 'Scene part'
    case 'tool': return c.tool === 'paint' ? 'Paint' : c.tool === 'walls' ? 'Walls' : c.tool === 'light' ? 'Light' : 'Fog'
    case 'scene': return 'Scene'
  }
}
