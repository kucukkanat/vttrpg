/**
 * Tiny typed event bus for effects that reach outside the VFX layer (camera shake today).
 * The table owner subscribes with `vfxBus.on('shake', ...)`; presets emit when they fire.
 * Module-level singleton: one table per page.
 */

export interface VfxBusEvents {
  /** Camera shake request. `strength` is 0..1, `durationMs` the decay time. */
  shake: (strength: number, durationMs: number) => void
}

export interface VfxBus {
  on<K extends keyof VfxBusEvents>(type: K, handler: VfxBusEvents[K]): () => void
  off<K extends keyof VfxBusEvents>(type: K, handler: VfxBusEvents[K]): void
  emit<K extends keyof VfxBusEvents>(type: K, ...args: Parameters<VfxBusEvents[K]>): void
  /** Number of listeners for a type (tests, diagnostics). */
  count(type: keyof VfxBusEvents): number
}

export function createVfxBus(): VfxBus {
  const handlers: { [K in keyof VfxBusEvents]?: Set<VfxBusEvents[K]> } = {}
  const bus: VfxBus = {
    on(type, handler) {
      const set = (handlers[type] ??= new Set()) as Set<typeof handler>
      set.add(handler)
      return () => bus.off(type, handler)
    },
    off(type, handler) {
      (handlers[type] as Set<typeof handler> | undefined)?.delete(handler)
    },
    emit(type, ...args) {
      const set = handlers[type] as Set<(...a: typeof args) => void> | undefined
      if (!set) return
      for (const h of Array.from(set)) h(...args)
    },
    count(type) {
      return handlers[type]?.size ?? 0
    },
  }
  return bus
}

export const vfxBus: VfxBus = createVfxBus()
