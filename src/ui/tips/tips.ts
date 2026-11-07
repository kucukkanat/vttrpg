/**
 * Layered tooltips: what is open, and where. At most two levels: a skill or a status (level 1),
 * and a glossary term opened from inside it (level 2), whose own terms are not links again.
 *
 *   hover / focus     shows level 1 for a moment; leaving hides it
 *   tap on the tip,   pins it: it stays until ✕, Esc (top level first) or a tap elsewhere
 *   long-press, i / ?
 *   a term in a tip   pins level 1 and opens the term as level 2
 *
 * `stepTips` is the pure state machine; `useTips` holds it for the HUD's TipLayer.
 */
import { create } from 'zustand'
import type { SkillId, TokenId } from '@/core/ids'

export type TipContent =
  | { kind: 'skill'; skill: SkillId; token: TokenId; reason?: string | null }
  | { kind: 'condition'; condition: string }
  | { kind: 'term'; id: string }

export interface Rect { x: number; y: number; w: number; h: number }

export interface Tip {
  content: TipContent
  anchor: Rect
  pinned: boolean
  /** Where focus goes back to when this level closes (the chip or link that opened it). */
  opener?: HTMLElement | null
}

export const MAX_TIP_LEVELS = 2

export type TipAction =
  | { type: 'hover'; tip: Omit<Tip, 'pinned'> }
  | { type: 'unhover' }
  | { type: 'pin'; tip: Omit<Tip, 'pinned'> }
  | { type: 'pinTop' }
  | { type: 'nest'; tip: Omit<Tip, 'pinned'> }
  | { type: 'closeTop' }
  | { type: 'closeAll' }

export const sameContent = (a: TipContent, b: TipContent): boolean => JSON.stringify(a) === JSON.stringify(b)

export function stepTips(stack: readonly Tip[], a: TipAction): Tip[] {
  const top = stack[stack.length - 1]
  switch (a.type) {
    case 'hover':
      // A pinned tip stays put while the pointer wanders over other chips.
      if (stack.some((t) => t.pinned)) return [...stack]
      return [{ ...a.tip, pinned: false }]
    case 'unhover':
      return stack.some((t) => t.pinned) ? [...stack] : []
    case 'pin':
      // Pinning what is already pinned on its own toggles it off (a second tap on the same status).
      if (stack.length === 1 && stack[0]!.pinned && sameContent(stack[0]!.content, a.tip.content)) return []
      return [{ ...a.tip, pinned: true }]
    case 'pinTop':
      return top ? [...stack.slice(0, -1), { ...top, pinned: true }] : []
    case 'nest': {
      const base = stack[0]
      if (!base) return [{ ...a.tip, pinned: true }]
      return [{ ...base, pinned: true }, { ...a.tip, pinned: true }].slice(0, MAX_TIP_LEVELS)
    }
    case 'closeTop':
      return stack.slice(0, -1)
    case 'closeAll':
      return []
  }
}

interface TipsState {
  stack: Tip[]
  dispatch(a: TipAction): void
}

export const useTips = create<TipsState>((set) => ({
  stack: [],
  dispatch: (a) => set((s) => ({ stack: stepTips(s.stack, a) })),
}))

export const tipDispatch = (a: TipAction) => useTips.getState().dispatch(a)

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * Viewport position for a tip of `size` next to `anchor`: above it when there is room (the token
 * bar sits at the bottom), else below; centred on the anchor and kept `margin` inside the viewport.
 */
export function placeTip(anchor: Rect, size: { w: number; h: number }, viewport: { w: number; h: number }, margin = 8): { left: number; top: number; above: boolean } {
  const gap = 8
  const above = anchor.y - gap - size.h >= margin || anchor.y + anchor.h + gap + size.h > viewport.h - margin
  const top = above ? Math.max(margin, anchor.y - gap - size.h) : Math.min(viewport.h - margin - size.h, anchor.y + anchor.h + gap)
  const left = Math.min(Math.max(margin, anchor.x + anchor.w / 2 - size.w / 2), Math.max(margin, viewport.w - margin - size.w))
  return { left, top: Math.max(margin, top), above }
}
