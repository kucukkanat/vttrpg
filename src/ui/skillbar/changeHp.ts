/**
 * GM: nudge a token's primary resource (HP) by `delta` and float the change over the token for
 * everyone, as a skill's damage or healing would. Shared by the token bar's −/+ and the token
 * menu's HP buttons. Returns whether anything changed.
 */
import type { Token } from '@/core/doc'
import { useGame } from '@/state/store'
import { readResource } from '@/table/tokenHud'
import type { GameController } from '../controller'
import { adjustResource } from './tokenBar'

export function changeTokenHp(controller: GameController, token: Token, delta: number): boolean {
  const rules = controller.rules
  const primary = rules?.pack.resources[0]
  const character = token.character ? useGame.getState().characters[token.character] : undefined
  if (!rules || !primary || !character) return false
  const evalMax = (e: string) => rules.evaluateNow(e, character)
  const before = readResource(character.data, primary, evalMax)
  const data = adjustResource(character.data, primary.id, delta, before?.max)
  if (!data) return false
  void controller.dispatch({ type: 'character.upsert', character: { ...character, data } })
  const after = readResource(data, primary, evalMax)
  const moved = after && before ? after.current - before.current : 0
  const down = !!after && !!before && before.current > 0 && after.current <= 0
  if (moved) controller.floatNumbers?.(token.scene, [{ token: token.id, delta: moved, resource: primary.id, ...(down ? { down } : {}) }])
  return moved !== 0
}
