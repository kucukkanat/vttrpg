/**
 * The skill currently being aimed, shared between the Skills panel (which starts and cancels it)
 * and the game screen (which hands it to the table as `TableCanvasProps.targeting`).
 */
import { create } from 'zustand'
import type { Character, Token } from '@/core/doc'
import type { TargetShape } from '@/core/geometry'
import type { PlayerPubkey, SkillId, TokenId } from '@/core/ids'

/**
 * Is this token a player's character: owned by a non-GM pubkey directly or through its sheet?
 * The targeting bar warns before a skill is cast at one.
 */
export function isPlayerCharacter(
  token: Pick<Token, 'owner' | 'character'>,
  character: Pick<Character, 'owner'> | undefined,
  gm: PlayerPubkey | undefined,
): boolean {
  const ownedByPlayer = (owner: PlayerPubkey | undefined) => !!owner && owner !== gm
  return ownedByPlayer(token.owner) || ownedByPlayer(character?.owner)
}

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
