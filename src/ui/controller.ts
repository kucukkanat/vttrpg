/**
 * GameController wires the modules together:
 *   connection (net)  ->  Y.Doc  ->  store (state)  ->  UI/table
 *   UI/table intents  ->  GM: validate (rules) + apply (state)  |  player: sendIntent (net)
 */
import { INTENT_QUEUE_TTL_MS, type GameConnection } from '@/net'
import { takePing } from '@/table/ping'
import { docBlockingSegments, moveBlocked, sceneWalls } from '@/table/build/wallEdit'
import { clearPendingMove, setPendingMove } from '@/table/tableState'
import { vfxBus } from '@/table/vfx/bus'
import { numbersEvent } from '@/table/vfx/numbers'
import type { RulesEngine } from '@/rules'
import type { AssetResolver } from '@/assets'
import type { Intent, IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { Character, GameDocShape, GameEvent, ResourceDelta, RollResult } from '@/core/doc'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import { applyIntent, type ApplyContext } from '@/state/apply'
import { bindDoc, useGame } from '@/state/store'
import { bindUndoDispatcher, recordUndo, undoLast } from '@/state/undo'
import { newSeed, rollFromSeed } from '@/dice'
import { withAdvantage } from '@/rules'
import type { TokenId } from '@/core/ids'
import { pushToast } from './toasts'
import { concentrationContext, damageContext, packNames, skillExtras } from './combat'
import { withRollMode } from './rollMode'

export interface GameController {
  connection: GameConnection
  rules: RulesEngine | null
  assets: AssetResolver
  pubkey: PlayerPubkey
  /** The name this client plays under; presence excludes self, so the UI reads it from here. Dev harnesses may omit it. */
  displayName?: string
  dispatch(intent: Intent): Promise<void>
  presence(partial: Partial<Presence>): void
  /**
   * GM only (a no-op for players): float damage/heal numbers over tokens on every table, as a
   * cue-less vfx event, for resource changes made by hand. Optional so test fakes can omit it.
   */
  floatNumbers?(scene: SceneId, numbers: ResourceDelta[]): void
  dispose(): void
}

export function createController(opts: {
  connection: GameConnection
  rules: RulesEngine | null
  assets: AssetResolver
  displayName: string
  pubkey: PlayerPubkey
}): GameController {
  const { connection, rules, assets } = opts
  const unbind = bindDoc(connection.doc)

  // Custom skills live in the doc; the engine merges them over the pack's skills by id.
  let customSig: string | undefined
  const syncCustomSkills = (custom: GameDocShape['customSkills']) => {
    if (!rules) return
    const sig = JSON.stringify(custom)
    if (sig === customSig) return
    customSig = sig
    rules.setCustomSkills(Object.values(custom))
  }
  syncCustomSkills(useGame.getState().customSkills)
  const offCustomSkills = useGame.subscribe((s) => syncCustomSkills(s.customSkills))
  const me: Presence = {
    pubkey: opts.pubkey,
    name: opts.displayName,
    color: '#7cc4ff',
    scene: null,
    lastSeen: Date.now(),
  }

  const docJson = (): GameDocShape => {
    const s = useGame.getState()
    return { meta: s.meta!, scenes: s.scenes, tokens: s.tokens, characters: s.characters, chat: s.chat, fog: s.fog, events: s.events, props: s.props, notes: s.notes, customSkills: s.customSkills, initiative: s.initiative ?? undefined, walls: s.walls, prefabs: s.prefabs, lights: s.lights }
  }

  /** A player's token move through a drawn or imported wall or a closed door (the table stops such drags too). */
  const crossesWall = (intent: Intent): boolean => {
    if (intent.type !== 'token.move') return false
    const s = useGame.getState()
    const t = s.tokens[intent.token]
    if (!t) return false
    return moveBlocked(t.position, intent.position, docBlockingSegments(s.scenes[t.scene], sceneWalls(s.walls, t.scene)))
  }

  /** The sheet a roll intent was made from, if it names one that still exists. */
  const rollCharacter = (intent: Intent): Character | undefined =>
    intent.type === 'roll' && intent.character ? useGame.getState().characters[intent.character] : undefined

  /** Sheet rolls are labelled "<character> · <label>" so the chat line names whose save it was. */
  const labelled = (env: IntentEnvelope): IntentEnvelope => {
    const character = rollCharacter(env.intent)
    if (env.intent.type !== 'roll' || !character) return env
    const label = env.intent.label ?? env.intent.formula
    return { ...env, intent: { ...env.intent, label: `${character.name} · ${label}` } }
  }

  async function resolveContext(env: IntentEnvelope): Promise<ApplyContext> {
    const ctx: ApplyContext = { pack: packNames(rules) }
    const { intent } = env
    if (intent.type === 'roll') {
      // Formulas from the sheet (`d20 <= str`) evaluate against the character they were rolled from.
      const character = rollCharacter(intent)
      // A player's blind roll: the GM mixes in its own seed so the roller cannot derive the result from theirs.
      const seed = intent.visibility === 'blind' && env.from !== connection.gm ? `${intent.seed}.${newSeed()}` : intent.seed
      const context: Record<string, unknown> = character ? { character } : {}
      if (intent.advantage) context.advantage = intent.advantage
      if (rules) ctx.roll = await rules.roll(intent.formula, seed, context)
      else {
        const formula = (intent.advantage && withAdvantage(intent.formula, intent.advantage)) || intent.formula
        ctx.roll = (await rollFromSeed(formula, seed)) as RollResult
        if (formula !== intent.formula && intent.advantage) ctx.roll.advantage = intent.advantage
      }
    }
    if (intent.type === 'damage.apply') ctx.damage = damageContext(rules, useGame.getState(), intent)
    if (intent.type === 'concentration.save' && rules) ctx.concentration = await concentrationContext(rules, useGame.getState(), intent)
    if (intent.type === 'skill.use' && rules) {
      const s = useGame.getState()
      const src = s.tokens[intent.source]
      const source = src?.character ? s.characters[src.character] : undefined
      // Tokens without a sheet still take part as targets (messages, vfx); patches to them are dropped by apply.
      const present = intent.targets.map((t) => s.tokens[t]).filter((t): t is NonNullable<typeof t> => !!t)
      const targets = present.map((t) => (t.character && s.characters[t.character]) || rules.blankCharacter(t.id, t.name))
      if (source) {
        const r = await rules.resolveSkill(intent.skill, source, targets, intent.seed, intent.advantage ? { advantage: intent.advantage } : {})
        const extras = skillExtras(rules, s, intent, present.map((t) => t.id as TokenId), r)
        ctx.skill = { patches: r.patches, messages: r.messages, vfx: r.vfx, ...extras, ...(r.crits ? { crits: r.crits } : {}) }
      }
    }
    return ctx
  }

  async function gmApply(env: IntentEnvelope) {
    if (env.from !== connection.gm && crossesWall(env.intent)) return
    if (rules) {
      // The founder and active co-GMs act as GM; the founder's signed manifest says who they are.
      const fromGm = connection.isWriter ? connection.isWriter(env.from) : env.from === connection.gm
      const reason = rules.validate(env.intent, { isGm: fromGm, pubkey: env.from }, docJson())
      if (reason) {
        if (env.from === opts.pubkey) console.warn('rejected own intent:', reason)
        return
      }
    }
    const named = labelled(env)
    let ctx: ApplyContext
    try {
      ctx = await resolveContext(named)
    } catch (e) {
      const what = named.intent.type === 'roll' ? (named.intent.label ?? named.intent.formula) : named.intent.type
      const text = `${what} failed: ${e instanceof Error ? e.message : String(e)}`
      console.warn(text, e)
      applyIntent(connection.doc, { ...env, intent: { type: 'chat.say', text, to: [env.from] } })
      return
    }
    applyIntent(connection.doc, named, ctx)
  }

  /**
   * GM only: remember the display name behind a pubkey in `meta.names` so chat can still name
   * someone after their presence expires. Written when first seen and again on a rename.
   */
  const rememberName = (pubkey: PlayerPubkey, name: string) => {
    if (!connection.isGm || !name.trim()) return
    const meta = connection.doc.getMap<unknown>('meta')
    const names = (meta.get('names') as Record<string, string> | undefined) ?? {}
    if (names[pubkey] === name) return
    meta.set('names', { ...names, [pubkey]: name })
  }
  rememberName(me.pubkey, me.name)

  const offIntent = connection.isGm ? connection.onIntent((env) => void gmApply(env)) : () => {}
  const pingsSeen = new Map<string, number>()
  const offPresence = connection.onPresence((p) => {
    useGame.getState().setPresence(p)
    rememberName(p.pubkey, p.name)
    const ping = takePing(pingsSeen, p)
    if (ping) vfxBus.emit('ping', ping)
  })

  const dispatch = async (raw: Intent): Promise<void> => {
    // Rolls and skills pick up the roll-mode toggles (advantage, GM-only, blind) at send time.
    const intent = withRollMode(raw, rules)
    const env: IntentEnvelope = { id: crypto.randomUUID(), from: me.pubkey, at: Date.now(), intent }
    if (!connection.isGm) {
      const result = connection.sendIntent(env)
      if ('rejected' in result) {
        if (result.rejected === 'gm-away') {
          const what = intent.type === 'roll' ? 'rolls' : intent.type === 'skill.use' ? 'skills' : 'that'
          pushToast({ key: 'gm-away', text: `The GM is away; ${what} wait until they are back` })
        }
        return
      }
      if ('queued' in result) {
        pushToast({ key: 'gm-away', text: 'Waiting for the GM… your move is queued' })
        if (intent.type === 'token.move') {
          // Hold the token where it was dropped (ghost look) until the GM's delta lands or the queue gives up.
          const token = intent.token
          const committed = useGame.getState().tokens[token]?.position ?? intent.position
          setPendingMove(token, { x: intent.position.x, z: intent.position.z, from: { x: committed.x, z: committed.z }, until: Date.now() + INTENT_QUEUE_TTL_MS })
          void result.settled.then((outcome) => {
            if (outcome === 'expired') {
              clearPendingMove(token)
              pushToast({ key: 'gm-away', text: 'The GM did not come back; your move was dropped' })
            } else {
              // Delivered: the document normally updates within a moment; if the GM refused it, snap back.
              setTimeout(() => clearPendingMove(token), 10_000)
            }
          })
        }
      }
      return
    }
    // Destructive intents from this client get an inverse on the undo stack and an Undo toast
    // before they are applied; `undoLast()` dispatches the inverse through this same function.
    bindUndoDispatcher(dispatch)
    const undo = recordUndo(intent, useGame.getState())
    if (undo) {
      pushToast({
        text: undo.label,
        action: { label: 'Undo', run: () => void undoLast().then((e) => e && pushToast({ text: `Restored ${e.subject}`, ttl: 2500 })) },
      })
    }
    await gmApply(env)
  }

  return {
    connection,
    rules,
    assets,
    pubkey: opts.pubkey,
    displayName: opts.displayName,
    dispatch,
    presence(partial) {
      Object.assign(me, partial, { lastSeen: Date.now() })
      connection.publishPresence(me)
      rememberName(me.pubkey, me.name)
    },
    floatNumbers(scene, numbers) {
      if (!connection.isGm) return
      const ev = numbersEvent(crypto.randomUUID(), Date.now(), scene, numbers)
      if (ev) connection.doc.getArray<GameEvent>('events').push([ev])
    },
    dispose() {
      offIntent()
      offPresence()
      offCustomSkills()
      unbind()
      connection.close()
    },
  }
}
