/**
 * Intents are requests from any client. Only the GM client applies them to the
 * document after validating against the active pack. Players apply them
 * optimistically and roll back if the GM's delta disagrees.
 */
import type { Vec3 } from './geometry'
import type { CharacterId, LightId, NoteId, PlayerPubkey, PrefabId, PropId, SceneId, SkillId, TokenId, WallId } from './ids'
import type { Token, Character, Scene, Prop, Note, InitiativeEntry, DeclaredAction, EncounterSummary, Wall, PlacedLight, Prefab, DamageFactor, RollAdvantage, RollVisibility, CreatureTemplate, Encounter } from './doc'
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
  /**
   * `advantage` turns the formula's first d20 (the pack's resolution die) into two dice, keeping
   * the better or worse. `visibility` hides the result from others (`gm`) or from the roller too (`blind`).
   */
  | { type: 'roll'; formula: string; seed: string; label?: string; character?: CharacterId; advantage?: RollAdvantage; visibility?: RollVisibility }
  /** GM only: show a hidden roll to everyone. */
  | { type: 'roll.reveal'; message: string }
  /** `advantage` applies to the skill's own rolls (rows that do not read `target.*`, so not the targets' saves). */
  | { type: 'skill.use'; skill: SkillId; source: TokenId; targets: TokenId[]; point?: Vec3; seed: string; advantage?: RollAdvantage }
  /**
   * Apply-damage card: apply chat message `message`'s amount to `token` scaled by `factor`
   * (`-1` heals, `0` undoes the previous choice). The GM reads the amount from the document.
   * GM, or a player for a token they own. `damageType` sets the type on a roll's card.
   */
  | { type: 'damage.apply'; message: string; token: TokenId; factor: DamageFactor | 0; damageType?: string }
  /** Roll the concentration save prompted by chat message `message` (GM or the token's owner). */
  | { type: 'concentration.save'; message: string; token: TokenId; seed: string; advantage?: RollAdvantage }
  /** End a token's concentration and every condition held by it (GM or the token's owner). */
  | { type: 'concentration.end'; token: TokenId }
  /** GM only: close a concentration prompt without a save (the damage did not count). */
  | { type: 'concentration.dismiss'; message: string }
  | { type: 'fog.reveal'; scene: SceneId; cells: string[] }
  | { type: 'fog.reset'; scene: SceneId }
  /** GM only: mark the whole scene explored (sets `FogState.revealAll`); `fog.reset` clears it again. */
  | { type: 'fog.revealAll'; scene: SceneId }
  /** A player takes an unowned token (or the GM assigns an owner). */
  | { type: 'token.claim'; token: TokenId; owner?: PlayerPubkey }
  /** GM soundboard: one-shot sound for everyone. */
  | { type: 'audio.play'; asset: AssetRef; volume?: number }
  /** GM soundboard: stop one sound for everyone (`asset`), or every one-shot still sounding. */
  | { type: 'audio.stop'; asset?: AssetRef }
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
  /** Game creature templates and encounters (GM only). */
  | { type: 'creature.upsert'; creature: CreatureTemplate }
  | { type: 'creature.remove'; creature: string }
  | { type: 'encounter.upsert'; encounter: Encounter }
  | { type: 'encounter.remove'; encounter: string }
  /** GM only: end the encounter; with `summary` a combat report goes to the chat log. */
  | { type: 'initiative.end'; summary?: EncounterSummary }
  /** GM only: declare what a combatant will do next (shown to everyone until resolved). */
  | { type: 'initiative.declare'; action: Omit<DeclaredAction, 'at'> }
  /** GM only: the declared action is done or called off. */
  | { type: 'initiative.resolve'; token: TokenId }
  /** GM fog brush: paint cells back into fog. Revealing goes through `fog.reveal`. */
  | { type: 'fog.hide'; scene: SceneId; cells: string[] }
  /** Walls and doors (GM only). `wall.add` and `wall.remove` take several so a stroke or a stamp is one change. */
  | { type: 'wall.add'; walls: Wall[] }
  | { type: 'wall.update'; wall: WallId; patch: Partial<Wall> }
  | { type: 'wall.remove'; walls: WallId[] }
  /** Open or close a door. The GM always; players when the scene allows it and the door is not locked. */
  | { type: 'door.set'; wall: WallId; open: boolean }
  /** Placed lights (GM only). */
  | { type: 'light.add'; light: PlacedLight }
  | { type: 'light.update'; light: LightId; patch: Partial<PlacedLight> }
  | { type: 'light.remove'; light: LightId }
  /** Prefabs (GM only). Stamping one is plain `prop.add` and `wall.add`. */
  | { type: 'prefab.upsert'; prefab: Prefab }
  | { type: 'prefab.remove'; prefab: PrefabId }

export interface IntentEnvelope {
  id: string
  from: PlayerPubkey
  at: number
  intent: Intent
}
