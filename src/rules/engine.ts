/**
 * The rules engine proper: rolls with pack resolution, expression evaluation
 * against characters, intent validation, deterministic chargen and skill
 * resolution. Pure: no rendering, no networking, all randomness from a seed.
 */
import type { Character, GameDocShape, RollResult } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { CharacterId } from '@/core/ids'
import type { ChargenStep, Effect, RollResolution, SkillDef } from '@/core/pack'
import { parseFormula } from '@/dice/fair'
import type { LoadedPack, RulesEngine } from './index'
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
): Record<string, unknown> | undefined {
  if (!resolution) return explicit === undefined ? undefined : { success: explicit, critical: false }
  const sides = resolution.kind === 'roll-under' ? parseFormula(resolution.die).terms[0].sides : 20
  const natural = dice.find((d) => d.sides === sides)?.value
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

  /** Where a cost/damage/heal `resource` lives in the sheet data. */
  function resourceRef(data: Data, id: string): { path: string[]; current: number | undefined; max: number | undefined } {
    if (id.includes('.')) {
      const path = id.split('.')
      const current = getPath(data, path)
      const max = path[path.length - 1] === 'current' ? getPath(data, [...path.slice(0, -1), 'max']) : undefined
      return { path, current: typeof current === 'number' ? current : undefined, max: typeof max === 'number' ? max : undefined }
    }
    const v = data[id]
    if (typeof v === 'number') return { path: [id], current: v, max: undefined }
    const current = getPath(v, ['current'])
    const max = getPath(v, ['max'])
    return {
      path: [id, 'current'],
      current: typeof current === 'number' ? current : undefined,
      max: typeof max === 'number' ? max : undefined,
    }
  }

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

  async function roll(formula: string, seed: string, context: Data = {}): Promise<RollResult> {
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
    const outcome = outcomeFor(resolution, dice, total, target, typeof value === 'boolean' ? value : undefined)
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
        const character = token.character ? doc.characters?.[token.character] : undefined
        if (!character) return 'the source token has no character sheet'
        if (skill.target.kind === 'single' && intent.targets.length > 1) return `${skill.name} targets a single token`
        if (skill.target.kind === 'self' && intent.targets.some((t) => t !== intent.source)) return `${skill.name} only targets yourself`
        return costShortfall(skill, character)
      }
      case 'initiative.start':
      case 'initiative.set':
      case 'initiative.next':
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

  async function resolveSkill(skillRef: string | SkillDef, source: Character, targets: Character[], seed: string) {
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
      const outcome = outcomeFor(resolution ?? DEFAULT_RESOLUTION, dice, total, target, typeof value === 'boolean' ? value : undefined)
      return {
        total,
        dice: dice.map((d) => d.value),
        target,
        success: outcome?.success as boolean | undefined,
        critical: Boolean(outcome?.critical),
      }
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
      return { patches: patchesFor(), messages, vfx: skill.vfx }
    }

    const applyEffect = async (e: Effect): Promise<void> => {
      switch (e.kind) {
        case 'roll': {
          const label = e.label ?? e.formula
          if (!e.vs) {
            const r = await rollInfo(e.formula, scopeFor())
            rolls[label] = r
            last = r
            messages.push(`${src.name} rolls ${label}: ${r.total}${diceText(r)}.`)
            return
          }
          for (const t of tgts.length ? tgts : [src]) {
            const tv = await evalNumber(e.vs, scopeFor(t), stream, `${label} target`)
            const r = await rollInfo(e.formula, scopeFor(t), tv)
            saves.set(t.id, r)
            rolls[label] = r
            last = r
            const verdict = r.success === undefined ? '' : r.success ? ' - success' : ' - failure'
            messages.push(`${t.name} ${label}: ${r.total}${diceText(r)} vs ${tv}${verdict}${r.critical ? ' (critical)' : ''}.`)
          }
          return
        }
        case 'damage':
        case 'heal': {
          for (const t of tgts) {
            const amount = Math.max(0, Math.floor(await evalNumber(e.formula, scopeFor(t), stream, `${e.kind} formula`)))
            const ref = resourceRef(t.data, e.resource)
            const label = labelOf(e.resource)
            if (ref.current === undefined) {
              // Sheetless tokens (plain minis) take part in messages and vfx but track no resources.
              messages.push(`${t.name} ${e.kind === 'damage' ? `takes ${amount} damage` : `would recover ${amount} ${label}`} (no ${label} tracked).`)
              continue
            }
            if (e.kind === 'damage') {
              const next = Math.max(0, ref.current - amount)
              setPath(t.data, ref.path, next)
              messages.push(`${t.name} takes ${amount} damage (${label} ${ref.current} to ${next})${next === 0 ? `, ${label} depleted` : ''}.`)
            } else {
              const next = ref.max === undefined ? ref.current + amount : Math.min(ref.max, ref.current + amount)
              setPath(t.data, ref.path, next)
              messages.push(`${t.name} recovers ${next - ref.current} ${label} (${ref.current} to ${next}).`)
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
              if (!next.has(id)) {
                next.add(id)
                messages.push(`${t.name} is now ${conditionName(id)}.`)
              }
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
    for (const e of skill.effects) await applyEffect(e)

    return { patches: patchesFor(), messages, vfx: skill.vfx }

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
