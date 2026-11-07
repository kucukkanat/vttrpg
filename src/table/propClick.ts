/**
 * Props that answer a plain click whatever the GM's Edit toggle says: a door opens or closes. The
 * prop pointer (propPointer.ts) asks `propClickFor` on every press; a prop with a handler keeps the
 * press (it does not fall through to the board) and its `click` runs on a tap without a drag,
 * with Edit on or off. Everything else about the prop (selection, drag, menu) still needs Edit on.
 *
 * Kinds register themselves (`registerPropClick`), so the pointer needs no knowledge of them.
 */
import type { Prop } from '@/core/doc'

export interface PropClickHandler {
  /** True when this handler answers clicks on `prop` for this viewer. */
  wants(prop: Prop, gm: boolean): boolean
  click(prop: Prop, gm: boolean): void
}

const handlers: PropClickHandler[] = []

/** Add a handler; returns its removal. */
export function registerPropClick(h: PropClickHandler): () => void {
  handlers.push(h)
  return () => {
    const i = handlers.indexOf(h)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** The handler that answers clicks on `prop`, if any. */
export function propClickFor(prop: Prop, gm: boolean): PropClickHandler | undefined {
  return handlers.find((h) => h.wants(prop, gm))
}
