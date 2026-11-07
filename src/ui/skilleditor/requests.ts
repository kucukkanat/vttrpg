/**
 * Asks the Skill editor panel to open something from elsewhere (the skill bar's token editor):
 * a new skill that gets attached to a token once saved, or an existing skill to edit.
 */
import { create } from 'zustand'
import type { TokenId } from '@/core/ids'

export type SkillEditorRequest =
  | { kind: 'new'; attachTo?: TokenId }
  | { kind: 'edit'; skillId: string }

export const useSkillEditorRequests = create<{ request: SkillEditorRequest | null }>(() => ({ request: null }))

export function requestSkillEditor(request: SkillEditorRequest): void {
  useSkillEditorRequests.setState({ request })
}

/** The pending request, removed from the queue. */
export function takeSkillEditorRequest(): SkillEditorRequest | null {
  const { request } = useSkillEditorRequests.getState()
  if (request) useSkillEditorRequests.setState({ request: null })
  return request
}
