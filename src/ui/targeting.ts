/**
 * The skill currently being aimed, shared between the Skills panel (which starts and cancels it)
 * and the game screen (which hands it to the table as `TableCanvasProps.targeting`).
 */
import { create } from 'zustand'
import type { TargetShape } from '@/core/geometry'
import type { SkillId, TokenId } from '@/core/ids'

export interface PendingSkill {
  skillId: SkillId
  name: string
  source: TokenId
  shape: TargetShape
}

export interface TargetingState {
  pending: PendingSkill | null
  /** When the last skill was dispatched; the panel shows chat outcomes newer than this. */
  firedAt: number | null
  start(p: PendingSkill): void
  clear(): void
  markFired(): void
}

export const useTargeting = create<TargetingState>((set) => ({
  pending: null,
  firedAt: null,
  start: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
  markFired: () => set({ firedAt: Date.now() }),
}))
