/**
 * GameController wires the modules together:
 *   connection (net)  ->  Y.Doc  ->  store (state)  ->  UI/table
 *   UI/table intents  ->  GM: validate (rules) + apply (state)  |  player: sendIntent (net)
 */
import type { GameConnection } from '@/net'
import type { RulesEngine } from '@/rules'
import type { AssetResolver } from '@/assets'
import type { Intent, IntentEnvelope } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { Character, GameDocShape, RollResult } from '@/core/doc'
import type { CharacterId, PlayerPubkey } from '@/core/ids'
import { applyIntent, type ApplyContext } from '@/state/apply'
import { bindDoc, useGame } from '@/state/store'
import { rollFromSeed } from '@/dice'

export interface GameController {
  connection: GameConnection
  rules: RulesEngine | null
  assets: AssetResolver
  pubkey: PlayerPubkey
  dispatch(intent: Intent): Promise<void>
  presence(partial: Partial<Presence>): void
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
  const me: Presence = {
    pubkey: opts.pubkey,
    name: opts.displayName,
    color: '#7cc4ff',
    scene: null,
    lastSeen: Date.now(),
  }

  const docJson = (): GameDocShape => {
    const s = useGame.getState()
    return { meta: s.meta!, scenes: s.scenes, tokens: s.tokens, characters: s.characters, chat: s.chat, fog: s.fog }
  }

  async function resolveContext(env: IntentEnvelope): Promise<ApplyContext> {
    const ctx: ApplyContext = {}
    const { intent } = env
    if (intent.type === 'roll') {
      ctx.roll = rules
        ? await rules.roll(intent.formula, intent.seed)
        : ((await rollFromSeed(intent.formula, intent.seed)) as RollResult)
    }
    if (intent.type === 'skill.use' && rules) {
      const s = useGame.getState()
      const src = s.tokens[intent.source]
      const source = src?.character ? s.characters[src.character] : undefined
      const targets = intent.targets
        .map((t) => s.tokens[t]?.character)
        .filter((c): c is CharacterId => !!c)
        .map((c) => s.characters[c])
        .filter((c): c is Character => !!c)
      if (source) {
        const r = await rules.resolveSkill(intent.skill, source, targets, intent.seed)
        ctx.skill = { patches: r.patches, messages: r.messages }
      }
    }
    return ctx
  }

  async function gmApply(env: IntentEnvelope) {
    if (rules) {
      const reason = rules.validate(env.intent, { isGm: env.from === connection.gm, pubkey: env.from }, docJson())
      if (reason) {
        if (env.from === connection.gm) console.warn('rejected own intent:', reason)
        return
      }
    }
    applyIntent(connection.doc, env, await resolveContext(env))
  }

  const offIntent = connection.isGm ? connection.onIntent((env) => void gmApply(env)) : () => {}
  const offPresence = connection.onPresence((p) => useGame.getState().setPresence(p))

  return {
    connection,
    rules,
    assets,
    pubkey: opts.pubkey,
    async dispatch(intent) {
      const env: IntentEnvelope = { id: crypto.randomUUID(), from: me.pubkey, at: Date.now(), intent }
      if (connection.isGm) await gmApply(env)
      else connection.sendIntent(env)
    },
    presence(partial) {
      Object.assign(me, partial, { lastSeen: Date.now() })
      connection.publishPresence(me)
    },
    dispose() {
      offIntent()
      offPresence()
      unbind()
      connection.close()
    },
  }
}
