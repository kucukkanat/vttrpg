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
import type { PlayerPubkey } from '@/core/ids'
import { applyIntent, type ApplyContext } from '@/state/apply'
import { bindDoc, useGame } from '@/state/store'
import { rollFromSeed } from '@/dice'

export interface GameController {
  connection: GameConnection
  rules: RulesEngine | null
  assets: AssetResolver
  pubkey: PlayerPubkey
  /** The name this client plays under; presence excludes self, so the UI reads it from here. Dev harnesses may omit it. */
  displayName?: string
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
    return { meta: s.meta!, scenes: s.scenes, tokens: s.tokens, characters: s.characters, chat: s.chat, fog: s.fog, events: s.events, props: s.props, notes: s.notes, customSkills: s.customSkills }
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
    const ctx: ApplyContext = {}
    const { intent } = env
    if (intent.type === 'roll') {
      // Formulas from the sheet (`d20 <= str`) evaluate against the character they were rolled from.
      const character = rollCharacter(intent)
      ctx.roll = rules
        ? await rules.roll(intent.formula, intent.seed, character ? { character } : {})
        : ((await rollFromSeed(intent.formula, intent.seed)) as RollResult)
    }
    if (intent.type === 'skill.use' && rules) {
      const s = useGame.getState()
      const src = s.tokens[intent.source]
      const source = src?.character ? s.characters[src.character] : undefined
      // Tokens without a sheet still take part as targets (messages, vfx); patches to them are dropped by apply.
      const targets = intent.targets
        .map((t) => s.tokens[t])
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t) => (t.character && s.characters[t.character]) || rules.blankCharacter(t.id, t.name))
      if (source) {
        const r = await rules.resolveSkill(intent.skill, source, targets, intent.seed)
        ctx.skill = { patches: r.patches, messages: r.messages, vfx: r.vfx }
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
  const offPresence = connection.onPresence((p) => {
    useGame.getState().setPresence(p)
    rememberName(p.pubkey, p.name)
  })

  return {
    connection,
    rules,
    assets,
    pubkey: opts.pubkey,
    displayName: opts.displayName,
    async dispatch(intent) {
      const env: IntentEnvelope = { id: crypto.randomUUID(), from: me.pubkey, at: Date.now(), intent }
      if (connection.isGm) await gmApply(env)
      else connection.sendIntent(env)
    },
    presence(partial) {
      Object.assign(me, partial, { lastSeen: Date.now() })
      connection.publishPresence(me)
      rememberName(me.pubkey, me.name)
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
