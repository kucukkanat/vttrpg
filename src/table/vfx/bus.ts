/**
 * Tiny typed event bus for effects that reach outside the VFX layer (camera shake today).
 * The table owner subscribes with `vfxBus.on('shake', ...)`; presets emit when they fire.
 * Module-level singleton: one table per page.
 */

import type { PingEvent } from '../ping'

export interface VfxBusEvents {
  /** Camera shake request. `strength` is 0..1, `durationMs` the decay time. */
  shake: (strength: number, durationMs: number) => void
  /** A table ping to play (the controller emits received ones; PingLayer draws them). */
  ping: (ping: PingEvent) => void
}

export interface VfxBus {
  on<K extends keyof VfxBusEvents>(type: K, handler: VfxBusEvents[K]): () => void
  off<K extends keyof VfxBusEvents>(type: K, handler: VfxBusEvents[K]): void
  emit<K extends keyof VfxBusEvents>(type: K, ...args: Parameters<VfxBusEvents[K]>): void
  /** Number of listeners for a type (tests, diagnostics). */
  count(type: keyof VfxBusEvents): number
}

export function createVfxBus(): VfxBus {
  type AnyHandler = (...args: never[]) => void
  const handlers = new Map<keyof VfxBusEvents, Set<AnyHandler>>()
  const bus: VfxBus = {
    on(type, handler) {
      let set = handlers.get(type)
      if (!set) { set = new Set(); handlers.set(type, set) }
      set.add(handler as AnyHandler)
      return () => bus.off(type, handler)
    },
    off(type, handler) {
      handlers.get(type)?.delete(handler as AnyHandler)
    },
    emit(type, ...args) {
      const set = handlers.get(type)
      if (!set) return
      for (const h of Array.from(set)) (h as unknown as (...a: typeof args) => void)(...args)
    },
    count(type) {
      return handlers.get(type)?.size ?? 0
    },
  }
  return bus
}

export const vfxBus: VfxBus = createVfxBus()
