/**
 * Intents are requests from any client. Only the GM client applies them to the
 * document after validating against the active pack. Players apply them
 * optimistically and roll back if the GM's delta disagrees.
 */
import type { Vec3 } from './geometry'
import type { CharacterId, PlayerPubkey, SceneId, SkillId, TokenId } from './ids'
import type { Token, Character, Scene } from './doc'

export type Intent =
  | { type: 'token.move'; token: TokenId; position: Vec3; rotationY?: number }
  | { type: 'token.add'; token: Token }
  | { type: 'token.remove'; token: TokenId }
  | { type: 'token.update'; token: TokenId; patch: Partial<Token> }
  | { type: 'scene.add'; scene: Scene }
  | { type: 'scene.activate'; scene: SceneId }
  | { type: 'scene.update'; scene: SceneId; patch: Partial<Scene> }
  | { type: 'character.upsert'; character: Character }
  | { type: 'character.remove'; character: CharacterId }
  | { type: 'chat.say'; text: string; to?: PlayerPubkey[] }
  | { type: 'roll'; formula: string; seed: string; label?: string; character?: CharacterId }
  | { type: 'skill.use'; skill: SkillId; source: TokenId; targets: TokenId[]; point?: Vec3; seed: string }
  | { type: 'fog.reveal'; scene: SceneId; cells: string[] }
  | { type: 'fog.reset'; scene: SceneId }

export interface IntentEnvelope {
  id: string
  from: PlayerPubkey
  at: number
  intent: Intent
}
