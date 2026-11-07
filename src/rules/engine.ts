/**
 * The rules engine proper: rolls with pack resolution, expression evaluation
 * against characters, intent validation, deterministic chargen and skill
 * resolution. Pure: no rendering, no networking, all randomness from a seed.
 */
import type { Character, GameDocShape, RollAdvantage, RollResult } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { CharacterId } from '@/core/ids'
import type { ChargenStep, ConditionDuration, Effect, RollResolution, SkillDef } from '@/core/pack'
import { parseFormula } from '@/dice/fair'
import type { LoadedPack, RulesEngine, SkillCondition, SkillDamage } from './index'
import { adjustForTraits, damageTraits, heal, resourceRef, takeDamage } from './damage'
import { advantageDie, naturalDie, withAdvantage } from './rollMode'
import {
  DiceStream,
  ExprError,
  composeScope,
  evaluate,
  evaluateSync,
  getPath,
  parse,
  setPath,
  usesDice,
  type Scope,
  type Value,
} from './expr'
import { emptyGrid, placeItems } from './inventory'
import { characterScope, inventoryField } from './scope'

type Data = Record<string, unknown>
type Die = { sides: number; value: number }

/** What a `roll` effect row leaves behind for later rows (`rolls.<label>`, `last`, `save`). */
interface RollInfo {
  total: number
  dice: number[]
  target?: number
  success?: boolean
  critical: boolean
  /** The resolution die as read for natural 1s and 20s: the kept die under advantage. */
  natural?: number
}

const DEFAULT_RESOLUTION: RollResolution = { kind: 'd20-vs-dc' }

const isCharacter = (v: unknown): v is Character =>
  typeof v === 'object' && v !== null && typeof (v as Character).name === 'string' && typeof (v as Character).data === 'object'

export function outcomeFor(
  resolution: RollResolution | undefined,
  dice: Die[],
  total: number,
  target: number | undefined,
  explicit?: boolean,
  formula?: string,
): Record<string, unknown> | undefined {
  if (!resolution) return explicit === undefined ? undefined : { success: explicit, critical: false }
  const sides = resolution.kind === 'roll-under' ? parseFormula(resolution.die).terms[0].sides : 20
  // With advantage the formula holds `2d20kh1`: the kept die is the natural one.
  const natural = formula ? naturalDie(formula, dice, sides) : dice.find((d) => d.sides === sides)?.value
  const out: Record<string, unknown> = { critical: natural === 1 || natural === sides }
  if (explicit !== undefined) out.success = explicit
  else if (target !== undefined) {
    out.target = target
    out.success = resolution.kind === 'roll-under' ? total <= target : total >= target
  }
  return out
}

export function createRulesEngine(pack: LoadedPack): RulesEngine {
  const grid = inventoryField(pack)
  const skillById = new Map<string, SkillDef>()
  let customSkills: SkillDef[] = []
  function rebuildSkills(): void {
    skillById.clear()
    for (const s of pack.skills) skillById.set(s.id as string, s)
    for (const s of customSkills) skillById.set(s.id as string, s)
  }
  rebuildSkills()
  function setCustomSkills(skills: SkillDef[]): void {
    customSkills = skills.slice()
    rebuildSkills()
  }
  const allSkills = (): SkillDef[] => [...skillById.values()]
  const resolution = pack.manifest.resolution

  const labelOf = (id: string): string =>
    pack.resources.find((r) => r.id === id)?.name ?? pack.attributes.find((a) => a.id === id)?.name ?? id

  /** Context entries that are characters become sub-scopes; the `character` entry is the base scope. */
  function contextScope(context: Data, base?: Character): Scope {
    const parts: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(context)) parts[k] = isCharacter(v) ? characterScope(v, pack) : v
    const root = base ?? (isCharacter(context.character) ? context.character : undefined)
    return composeScope(parts, root ? characterScope(root, pack) : () => undefined)
  }

  function toNumber(v: Value): number {
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return v ? 1 : 0
    const n = Number(v)
    if (Number.isNaN(n)) throw new ExprError(`"${v}" is not a number`)
    return n
  }

  async function evalNumber(src: string, scope: Scope, stream: DiceStream, what: string): Promise<number> {
    const v = await evaluate(src, scope, stream)
    if (typeof v !== 'number') throw new ExprError(`${what} must evaluate to a number, got ${JSON.stringify(v)}`)
    return v
  }

  // ------------------------------------------------------------------ roll

  async function roll(rawFormula: string, seed: string, context: Data = {}): Promise<RollResult> {
    const mode = context.advantage === 'advantage' || context.advantage === 'disadvantage' ? (context.advantage as RollAdvantage) : undefined
    const doubled = mode ? withAdvantage(rawFormula, mode, resolution) : null
    const formula = doubled ?? rawFormula
    const stream = new DiceStream(seed)
    const scope = contextScope(context)
    const value = await evaluate(formula, scope, stream)
    const dice = stream.dice
    // A comparison formula ("d20 <= str") yields the verdict; the number people read is the dice sum.
    const total = typeof value === 'boolean' ? dice.reduce((n, d) => n + d.value, 0) : toNumber(value)
    let target: number | undefined
    if (typeof context.target === 'number') target = context.target
    else if (typeof context.dc === 'number') target = context.dc
    else if (typeof context.vs === 'number') target = context.vs
    else if (typeof context.vs === 'string') target = toNumber(evaluateSync(context.vs, scope))
    const result: RollResult = { formula, seed, dice, total }
    if (doubled && mode) result.advantage = mode
    const outcome = outcomeFor(resolution, dice, total, target, typeof value === 'boolean' ? value : undefined, formula)
    if (outcome) result.outcome = outcome
    return result
  }

  // -------------------------------------------------------------- evaluate

  async function evaluateFor(expr: string, character: Character, context: Data = {}): Promise<Value> {
    const scope = contextScope(context, character)
    const ast = parse(expr)
    if (!usesDice(ast)) return evaluateSync(ast, scope)
    if (typeof context.seed !== 'string') throw new ExprError('expression uses dice; pass a seed in context.seed', expr)
    return evaluate(ast, scope, new DiceStream(context.seed))
  }

  // -------------------------------------------------------------- validate

  function costShortfall(skill: SkillDef, character: Character): string | null {
    const scope = characterScope(character, pack)
    for (const cost of skill.cost ?? []) {
      let amount: Value
      try {
        amount = evaluateSync(cost.amount, scope)
      } catch (e) {
        return `cost of ${skill.name}: ${(e as Error).message}`
      }
      const ref = resourceRef(character.data, cost.resource)
      if (ref.current === undefined) return `${character.name} has no ${labelOf(cost.resource)}`
      if (ref.current < toNumber(amount)) return `not enough ${labelOf(cost.resource)} (${ref.current}/${String(amount)})`
    }
    return null
  }

  function validate(intent: Intent, actor: { isGm: boolean; pubkey: string }, docRaw: unknown): string | null {
    const doc = docRaw as GameDocShape
    // Holds for the GM too: the table always has a live scene to show.
    if (intent.type === 'scene.remove' && doc.meta?.activeScene === intent.scene) return 'switch to another scene before removing the live one'
    if (actor.isGm) return null
    switch (intent.type) {
      case 'roll':
      case 'chat.say':
        return null
      case 'token.claim': {
        const t = doc.tokens?.[intent.token]
        if (!t) return 'unknown token'
        if (intent.owner && intent.owner !== actor.pubkey) return 'only the GM may assign tokens to others'
        return t.owner && t.owner !== actor.pubkey ? 'that token already has an owner' : null
      }
      case 'token.move':
      case 'token.update': {
        const t = doc.tokens?.[intent.token]
        if (!t) return 'unknown token'
        if (intent.type === 'token.update' && 'skills' in intent.patch) return 'only the GM changes what skills a token has'
        return t.owner === actor.pubkey ? null : 'you do not own this token'
      }
      case 'character.upsert': {
        if (intent.character.owner !== actor.pubkey) return 'players may only save characters they own'
        const existing = doc.characters?.[intent.character.id]
        if (existing && existing.owner !== actor.pubkey) return 'that character belongs to someone else'
        return null
      }
      case 'character.remove': {
        const existing = doc.characters?.[intent.character]
        if (!existing) return 'unknown character'
        return existing.owner === actor.pubkey ? null : 'that character belongs to someone else'
      }
      case 'skill.use': {
        const skill = skillById.get(intent.skill)
        if (!skill) return `unknown skill "${intent.skill}"`
        const token = doc.tokens?.[intent.source]
        if (!token) return 'unknown source token'
        if (token.owner !== actor.pubkey) return 'you do not control the source token'
        if (token.skills && !token.skills.includes(intent.skill)) return `${token.name} does not have ${skill.name}`
        const character = token.character ? doc.characters?.[token.character] : undefined
        if (!character) return 'the source token has no character sheet'
        if (skill.target.kind === 'single' && intent.targets.length > 1) return `${skill.name} targets a single token`
        if (skill.target.kind === 'self' && intent.targets.some((t) => t !== intent.source)) return `${skill.name} only targets yourself`
        return costShortfall(skill, character)
      }
      case 'damage.apply':
      case 'concentration.save':
      case 'concentration.end': {
        // Owners may apply a card to, or roll and drop concentration for, their own tokens only.
        const t = doc.tokens?.[intent.token]
        if (!t) return 'unknown token'
        if (t.owner !== actor.pubkey) return 'you do not own this token'
        if (intent.type === 'concentration.end') return null
        const m = doc.chat?.find((x) => x.id === intent.message)
        if (!m) return 'unknown message'
        if (intent.type === 'damage.apply') return m.damage || m.roll ? null : 'that message has nothing to apply'
        return m.concentration?.token === intent.token && !m.concentration.result ? null : 'no open concentration save for that token'
      }
      case 'initiative.next': {
        // A player ends their own turn: the token must be theirs and currently up.
        if (!intent.token) return 'only the GM runs initiative'
        const t = doc.tokens?.[intent.token]
        if (!t || t.owner !== actor.pubkey) return 'you do not control that token'
        const init = doc.initiative
        if (!init?.active || init.order[init.turn]?.token !== intent.token) return 'it is not that token\'s turn'
        return null
      }
      case 'initiative.start':
      case 'initiative.set':
      case 'initiative.remove':
      case 'initiative.end':
        return 'only the GM runs initiative'
      default:
        return 'only the GM may do that'
    }
  }

  // --------------------------------------------------------------- chargen

  function initialData(): Data {
    const data: Data = {}
    for (const a of pack.attributes) if (a.derived === undefined) data[a.id] = { current: 0, max: 0 }
    for (const r of pack.resources) data[r.id] = { current: 0, max: 0 }
    data.conditions = []
    if (grid.declared) data[grid.bind] = emptyGrid(grid)
    data.notes = ''
    return data
  }

  function lookupRow(rows: Record<string, Data>, key: string): Data | undefined {
    if (rows[key]) return rows[key]
    const n = Number(key)
    for (const [k, row] of Object.entries(rows)) {
      const m = /^(\d+)-(\d+)$/.exec(k)
      if (m && n >= Number(m[1]) && n <= Number(m[2])) return row
    }
    return undefined
  }

  /** Literal merge used by table rows and `set` steps. */
  function mergeInto(data: Data, values: Data): void {
    for (const [k, v] of Object.entries(values)) {
      if ((k === 'items' || k === grid.bind) && Array.isArray(v)) {
        let slots = data[grid.bind]
        if (!Array.isArray(slots)) data[grid.bind] = slots = emptyGrid(grid)
        placeItems(slots as never[], grid, v)
        continue
      }
      const path = k.split('.')
      const existing = getPath(data, path)
      if (Array.isArray(v) && Array.isArray(existing)) existing.push(...v)
      else setPath(data, path, v)
    }
  }

  async function runStep(step: ChargenStep, ch: Character, stream: DiceStream): Promise<void> {
    const data = ch.data
    const scope = characterScope(ch, pack)
    for (const [path, src] of Object.entries(step.assign ?? {})) {
      const v = await evaluate(src, scope, stream)
      setPath(data, path.split('.'), v)
    }
    if (step.table) {
      const table = pack.chargen?.tables[step.table]
      if (!table) throw new Error(`chargen step "${step.id}": unknown table "${step.table}"`)
      let key: string
      if (table.die === 'd66') key = `${await stream.next(6)}${await stream.next(6)}`
      else key = String(toNumber(await evaluate(table.die, () => undefined, stream)))
      const row = lookupRow(table.rows, key)
      if (!row) throw new Error(`chargen table "${step.table}" has no row for ${key}`)
      mergeInto(data, row)
    }
    if (step.choose) {
      const { bind, options } = step.choose
      const idx = options.length === 1 ? 0 : (await stream.next(options.length)) - 1
      setPath(data, bind.split('.'), options[idx])
    }
    if (step.set) mergeInto(data, step.set)
  }

  async function generateCharacter(seed: string, name: string): Promise<Character> {
    if (!pack.chargen) throw new Error(`pack "${pack.manifest.id}" has no chargen`)
    const ch: Character = {
      id: `${pack.manifest.id}-${seed.slice(0, 12)}` as CharacterId,
      name,
      data: initialData(),
    }
    const stream = new DiceStream(seed)
    for (const step of pack.chargen.steps) await runStep(step, ch, stream)
    return ch
  }

  // ---------------------------------------------------------------- skills

  async function resolveSkill(skillRef: string | SkillDef, source: Character, targets: Character[], seed: string, opts: { advantage?: RollAdvantage } = {}) {
    const skill = typeof skillRef === 'string' ? skillById.get(skillRef) : skillRef
    if (!skill) throw new Error(`unknown skill "${String(skillRef)}"`)
    const stream = new DiceStream(seed)
    const messages: string[] = []
    const originals = new Map<string, Character>()
    const copies = new Map<string, Character>()
    const copyOf = (c: Character): Character => {
      let w = copies.get(c.id)
      if (!w) {
        w = { ...c, data: structuredClone(c.data) }
        copies.set(c.id, w)
        originals.set(c.id, c)
      }
      return w
    }
    const src = copyOf(source)
    const tgts = targets.map(copyOf)
    const rolls: Record<string, RollInfo> = {}
    let last: RollInfo | undefined
    const saves = new Map<string, RollInfo>()
    const damage: SkillDamage[] = []
    const added: SkillCondition[] = []
    const model = pack.manifest.damage
    const indexOf = (t: Character) => tgts.indexOf(t)
    /** The caster's own rolls take advantage; rows that read `target.*` are the targets' (saves) and do not. */
    const mode = (formula: string) => (opts.advantage && !/\btarget\./.test(formula) ? withAdvantage(formula, opts.advantage, resolution) : null)

    const scopeFor = (target?: Character): Scope =>
      composeScope(
        {
          source: characterScope(src, pack),
          target: target ? characterScope(target, pack) : undefined,
          rolls,
          last,
          save: target ? saves.get(target.id) : undefined,
          targets: tgts.length,
        },
        characterScope(src, pack),
      )

    const rollInfo = async (formula: string, scope: Scope, target?: number): Promise<RollInfo> => {
      const before = stream.dice.length
      const value = await evaluate(formula, scope, stream)
      const dice = stream.dice.slice(before)
      const total = toNumber(value)
      const outcome = outcomeFor(resolution ?? DEFAULT_RESOLUTION, dice, total, target, typeof value === 'boolean' ? value : undefined, formula)
      const info: RollInfo = {
        total,
        dice: dice.map((d) => d.value),
        target,
        success: outcome?.success as boolean | undefined,
        critical: Boolean(outcome?.critical),
      }
      const natural = naturalDie(formula, dice, advantageDie(resolution ?? DEFAULT_RESOLUTION))
      if (natural !== undefined) info.natural = natural
      return info
    }
    const diceText = (r: RollInfo) => (r.dice.length ? ` [${r.dice.join(', ')}]` : '')

    for (const cost of skill.cost ?? []) {
      const amount = Math.max(0, Math.floor(await evalNumber(cost.amount, scopeFor(), stream, `cost of ${skill.name}`)))
      const ref = resourceRef(src.data, cost.resource)
      if (ref.current === undefined) throw new Error(`${src.name} has no ${labelOf(cost.resource)} to spend`)
      if (ref.current < amount) throw new Error(`${src.name} cannot pay ${amount} ${labelOf(cost.resource)}`)
      setPath(src.data, ref.path, ref.current - amount)
      if (amount > 0) messages.push(`${src.name} spends ${amount} ${labelOf(cost.resource)} on ${skill.name}.`)
    }

    // An area skill aimed at empty ground: the cost is paid and the vfx still plays, but there is
    // nobody to save, damage or condition, so no roll is made against nothing.
    const areaShape = skill.target.kind === 'radius' || skill.target.kind === 'cone' || skill.target.kind === 'line'
    if (areaShape && tgts.length === 0) {
      messages.push(`${skill.name} hits no one.`)
      return { patches: patchesFor(), messages, vfx: skill.vfx, damage, conditions: added }
    }

    const applyEffect = async (e: Effect): Promise<void> => {
      switch (e.kind) {
        case 'roll': {
          const label = e.label ?? e.formula
          const doubled = mode(e.formula)
          const formula = doubled ?? e.formula
          const adv = doubled ? ` with ${opts.advantage}` : ''
          if (!e.vs) {
            const r = await rollInfo(formula, scopeFor())
            rolls[label] = r
            last = r
            messages.push(`${src.name} rolls ${label}${adv}: ${r.total}${diceText(r)}.`)
            return
          }
          for (const t of tgts.length ? tgts : [src]) {
            const tv = await evalNumber(e.vs, scopeFor(t), stream, `${label} target`)
            const r = await rollInfo(formula, scopeFor(t), tv)
            saves.set(t.id, r)
            rolls[label] = r
            last = r
            const verdict = r.success === undefined ? '' : r.success ? ' - success' : ' - failure'
            messages.push(`${t.name} ${label}${adv}: ${r.total}${diceText(r)} vs ${tv}${verdict}${r.critical ? ' (critical)' : ''}.`)
          }
          return
        }
        case 'damage':
        case 'heal': {
          for (const t of tgts) {
            const raw = Math.max(0, Math.floor(await evalNumber(e.formula, scopeFor(t), stream, `${e.kind} formula`)))
            const ref = resourceRef(t.data, e.resource)
            const label = labelOf(e.resource)
            const type = e.kind === 'damage' ? await damageType(e.type, scopeFor(t)) : undefined
            if (ref.current === undefined) {
              // Sheetless tokens (plain minis) take part in messages and vfx but track no resources.
              messages.push(`${t.name} ${e.kind === 'damage' ? `takes ${raw} damage` : `would recover ${raw} ${label}`} (no ${label} tracked).`)
              const entry: SkillDamage = { target: indexOf(t), amount: raw, final: raw, changes: [] }
              if (e.kind === 'heal') entry.heal = true
              else if (type) entry.type = type
              damage.push(entry)
              continue
            }
            if (e.kind === 'damage') {
              // Damage types and resistances apply when the pack has a damage model.
              const typed = model ? adjustForTraits(raw, type, damageTraits(t.data, model, pack.conditions)) : { amount: raw }
              const tempBefore = model?.temp ? resourceRef(t.data, model.temp).current ?? 0 : 0
              const changes = takeDamage(t.data, e.resource, typed.amount, model)
              const next = resourceRef(t.data, e.resource).current ?? 0
              const tempAfter = model?.temp ? resourceRef(t.data, model.temp).current ?? 0 : 0
              const kind = type ? `${typeName(type)} ` : ''
              const note = typed.note ? `, ${typed.note}` : ''
              const temp = tempBefore !== tempAfter ? `, ${tempBefore - tempAfter} absorbed by ${labelOf(model!.temp!)}` : ''
              messages.push(`${t.name} takes ${typed.amount} ${kind}damage${note}${temp} (${label} ${ref.current} to ${next})${next === 0 ? `, ${label} depleted` : ''}.`)
              const entry: SkillDamage = { target: indexOf(t), amount: raw, final: typed.amount, changes }
              if (type) entry.type = type
              if (typed.note) entry.note = typed.note
              damage.push(entry)
            } else {
              const isTemp = !!model?.temp && e.resource === model.temp
              const before = ref.current
              const changes = heal(t.data, e.resource, raw, model)
              const next = resourceRef(t.data, e.resource).current ?? 0
              messages.push(isTemp
                ? (next > before ? `${t.name} gains ${next} ${label} (was ${before}).` : `${t.name} keeps ${before} ${label} (${raw} does not stack).`)
                : `${t.name} recovers ${next - before} ${label} (${before} to ${next}).`)
              const entry: SkillDamage = { target: indexOf(t), amount: raw, final: next - before, heal: true, changes }
              if (isTemp) entry.temp = true
              damage.push(entry)
            }
          }
          return
        }
        case 'condition': {
          for (const t of tgts.length ? tgts : [src]) {
            const list = Array.isArray(t.data.conditions) ? (t.data.conditions as unknown[]).filter((x): x is string => typeof x === 'string') : []
            const next = new Set(list)
            for (const id of e.remove ?? []) if (next.delete(id)) messages.push(`${t.name} is no longer ${conditionName(id)}.`)
            for (const id of e.add ?? []) {
              if (!pack.conditions.some((c) => c.id === id)) throw new Error(`${skill.name}: unknown condition "${id}"`)
              const lasts = e.duration ? ` for ${turnsText(e.duration)}` : ''
              if (!next.has(id)) {
                next.add(id)
                messages.push(`${t.name} is now ${conditionName(id)}${lasts}.`)
              }
              const entry: SkillCondition = { target: tgts.length ? indexOf(t) : -1, condition: id }
              if (e.duration) entry.duration = e.duration
              added.push(entry)
            }
            t.data.conditions = [...next]
          }
          return
        }
        case 'move':
          messages.push(`${src.name} moves ${e.cells} ${Math.abs(e.cells) === 1 ? 'cell' : 'cells'}.`)
          return
        case 'message': {
          const perTarget = tgts.length > 0 && /\{[^}]*\btarget\b[^}]*\}/.test(e.text)
          const who = perTarget ? tgts : [tgts[0]]
          for (const t of who) messages.push(await interpolate(e.text, scopeFor(t), stream))
          return
        }
      }
    }
    /** A row's damage type: a literal id, or `{melee.type}` read from the sheet (missing = untyped). */
    async function damageType(spec: string | undefined, scope: Scope): Promise<string | undefined> {
      if (!spec) return undefined
      if (!spec.includes('{')) return spec
      try {
        const v = (await interpolate(spec, scope, stream)).trim().toLowerCase()
        return v && v !== 'undefined' ? v : undefined
      } catch {
        return undefined
      }
    }

    for (const e of skill.effects) await applyEffect(e)

    return { patches: patchesFor(), messages, vfx: skill.vfx, damage, conditions: added }

    /** Changed top-level sheet keys per touched character. */
    function patchesFor(): { character: string; data: Data }[] {
      const patches: { character: string; data: Data }[] = []
      for (const [id, copy] of copies) {
        const original = originals.get(id)!.data
        const changed: Data = {}
        for (const key of new Set([...Object.keys(original), ...Object.keys(copy.data)]))
          if (JSON.stringify(original[key]) !== JSON.stringify(copy.data[key])) changed[key] = copy.data[key]
        if (Object.keys(changed).length) patches.push({ character: id, data: changed })
      }
      return patches
    }
  }

  function conditionName(id: string): string {
    return pack.conditions.find((c) => c.id === id)?.name ?? id
  }

  function typeName(id: string): string {
    return (pack.manifest.damage?.types?.find((t) => t.id === id)?.name ?? id).toLowerCase()
  }

  function turnsText(d: ConditionDuration): string {
    return `${d.turns} ${d.turns === 1 ? 'turn' : 'turns'}`
  }

  async function interpolate(text: string, scope: Scope, stream: DiceStream): Promise<string> {
    let out = ''
    let i = 0
    for (const m of text.matchAll(/\{([^}]*)\}/g)) {
      out += text.slice(i, m.index) + String(await evaluate(m[1], scope, stream))
      i = m.index + m[0].length
    }
    return out + text.slice(i)
  }

  /** A character with the pack's default (zeroed) data: used for plain minis that have no sheet. */
  function blankCharacter(id: string, name: string): Character {
    return { id: id as Character['id'], name, data: initialData() }
  }

  function evaluateNow(expr: string, character: Character, context: Data = {}): Value {
    return evaluateSync(expr, contextScope(context, character))
  }
  return { pack, roll, evaluate: evaluateFor, evaluateNow, blankCharacter, validate, generateCharacter, resolveSkill, setCustomSkills, allSkills }
}
