/**
 * Intents are requests from any client. Only the GM client applies them to the
 * document after validating against the active pack. Players apply them
 * optimistically and roll back if the GM's delta disagrees.
 */
import type { Vec3 } from './geometry'
import type { CharacterId, NoteId, PlayerPubkey, PropId, SceneId, SkillId, TokenId } from './ids'
import type { Token, Character, Scene, Prop, Note, InitiativeEntry, CreatureTemplate, Encounter } from './doc'
import type { SkillDef } from './pack'
import type { AssetRef } from './assets'

export type Intent =
  | { type: 'token.move'; token: TokenId; position: Vec3; rotationY?: number }
  | { type: 'token.add'; token: Token }
  | { type: 'token.remove'; token: TokenId }
  | { type: 'token.update'; token: TokenId; patch: Partial<Token> }
  | { type: 'scene.add'; scene: Scene }
  | { type: 'scene.activate'; scene: SceneId }
  | { type: 'scene.update'; scene: SceneId; patch: Partial<Scene> }
  /**
   * GM only; the active scene cannot be removed. Deletes the scene record only: its tokens, props
   * and fog state stay in the document (nothing renders them while the scene is gone), so undoing
   * with `scene.add` brings the scene back exactly as it was.
   */
  | { type: 'scene.remove'; scene: SceneId }
  | { type: 'character.upsert'; character: Character }
  | { type: 'character.remove'; character: CharacterId }
  | { type: 'chat.say'; text: string; to?: PlayerPubkey[] }
  | { type: 'roll'; formula: string; seed: string; label?: string; character?: CharacterId }
  | { type: 'skill.use'; skill: SkillId; source: TokenId; targets: TokenId[]; point?: Vec3; seed: string }
  | { type: 'fog.reveal'; scene: SceneId; cells: string[] }
  | { type: 'fog.reset'; scene: SceneId }
  /** GM only: mark the whole scene explored (sets `FogState.revealAll`); `fog.reset` clears it again. */
  | { type: 'fog.revealAll'; scene: SceneId }
  /** A player takes an unowned token (or the GM assigns an owner). */
  | { type: 'token.claim'; token: TokenId; owner?: PlayerPubkey }
  /** GM soundboard: one-shot sound for everyone. */
  | { type: 'audio.play'; asset: AssetRef; volume?: number }
  /** GM housekeeping: drop events older than `before`. */
  | { type: 'event.prune'; before: number }
  /** Standalone props (GM only). */
  | { type: 'prop.add'; prop: Prop }
  | { type: 'prop.update'; prop: PropId; patch: Partial<Prop> }
  | { type: 'prop.remove'; prop: PropId }
  /** Journal and handouts (GM only). */
  | { type: 'note.upsert'; note: Note }
  | { type: 'note.remove'; note: NoteId }
  /** Custom skills for this game (GM only). */
  | { type: 'skill.upsert'; skill: SkillDef }
  | { type: 'skill.remove'; skill: SkillId }
  /**
   * Initiative tracker (GM only). `start` carries the resolved order: the GM client rolls each
   * combatant's score before dispatching (a pack initiative formula or a plain d20) and records
   * the `seed` it used so the rolls can be re-derived. `apply` sorts the order highest first.
   */
  | { type: 'initiative.start'; order: InitiativeEntry[]; seed?: string }
  /** Replace the order as given (reorder by hand, edit a score, add a combatant); the current combatant keeps its turn. */
  | { type: 'initiative.set'; order: InitiativeEntry[] }
  /**
   * Advance one turn; past the last combatant the round increments and the first one is up again.
   * With `token` it is "end my turn": applied only while that token is up, so a late or repeated
   * press cannot skip someone. Players may send it for a token they own; plain `next` is GM only.
   */
  | { type: 'initiative.next'; token?: TokenId }
  | { type: 'initiative.remove'; token: TokenId }
  | { type: 'initiative.end' }
  /** Game creature templates and encounters (GM only). */
  | { type: 'creature.upsert'; creature: CreatureTemplate }
  | { type: 'creature.remove'; creature: string }
  | { type: 'encounter.upsert'; encounter: Encounter }
  | { type: 'encounter.remove'; encounter: string }

export interface IntentEnvelope {
  id: string
  from: PlayerPubkey
  at: number
  intent: Intent
}
