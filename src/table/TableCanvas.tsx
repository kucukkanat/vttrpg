// TODO(table session): implement. Renders the active scene, grid, tokens, cameras.
import type { Intent } from '@/core/intents'
import type { Presence } from '@/core/presence'

export interface TableCanvasProps {
  onIntent(intent: Intent): void
  onPresence(p: Partial<Presence>): void
}

export function TableCanvas(_props: TableCanvasProps) {
  return <div style={{ padding: 16 }}>table: not implemented</div>
}
