/**
 * Version 1 props on the table (see src/core/props.ts for the migration itself).
 *
 * A legacy prop's size depends on its loaded model, so `PropMesh` measures the one-cell fit when
 * the model arrives and records it here: the gizmo and the panel read it to show the same size the
 * renderer draws. A GM client also queues a `props.migrate` for it; the queue sends one batched
 * intent for every legacy prop that loaded within a short window, so opening an old scene with
 * many props migrates them in one change.
 */
import type { Intent } from '@/core/intents'
import type { PropId } from '@/core/ids'

const fits = new Map<PropId, number>()
const pending = new Map<PropId, number>()
let timer: ReturnType<typeof setTimeout> | null = null

/** The fit measured for a legacy prop's model, if it has loaded on this client. */
export function knownLegacyFit(id: PropId): number | undefined {
  return fits.get(id)
}

export function noteLegacyFit(id: PropId, fit: number): void {
  fits.set(id, fit)
}

/** Queue `id` for migration with `fit`; `send` gets one `props.migrate` after `delayMs` of quiet. */
export function queuePropMigration(id: PropId, fit: number, send: (intent: Intent) => void, delayMs = 300): void {
  if (!(fit > 0) || !Number.isFinite(fit)) return
  pending.set(id, fit)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const intent = takePropMigrations()
    if (intent) send(intent)
  }, delayMs)
}

/** The queued migrations as one intent (emptying the queue), or null when there are none. */
export function takePropMigrations(): Extract<Intent, { type: 'props.migrate' }> | null {
  if (!pending.size) return null
  const items = [...pending].map(([id, fit]) => ({ id, fit }))
  pending.clear()
  return { type: 'props.migrate', items }
}
