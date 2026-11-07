/**
 * Turning encounter rows into tokens: each token gets its own copy of the stat block (own hit
 * points, rolled or average), the creature's compiled action skills are saved as game skills
 * once, and a placed group can join the initiative order with one roll per row.
 */
import type { CreatureTemplate, EncounterRow, Token } from '@/core/doc'
import type { CreatureEntry } from '@/core/pack'
import type { TokenId } from '@/core/ids'
import { compileActionSkills, creatureSkillPrefix } from '@/rules'
import { newSeed, rollFromSeed } from '@/dice'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { rollInitiative } from '../panels/initiative'
import { creatureSheetData, hpFormula, mergeGroupInitiative, resolveCreature, rowName, tokenNames, type ResolvedCreature } from './encounters'
import { spawnNpcs, type Spawned, type SpawnSpec } from './npc'

/**
 * Save the creature's action skills as game skills (only those that changed) and return their ids
 * in bar order. Skills of this creature that no longer compile are removed unless a token still
 * lists them.
 */
export async function syncCreatureSkills(controller: GameController, creature: Pick<ResolvedCreature, 'ref' | 'data'>): Promise<string[]> {
  const rules = controller.rules
  if (!rules) return []
  const skills = compileActionSkills(rules.pack, creature.ref, creature.data)
  const s = useGame.getState()
  for (const skill of skills) {
    const prev = s.customSkills[skill.id]
    if (!prev || JSON.stringify(prev) !== JSON.stringify(skill)) await controller.dispatch({ type: 'skill.upsert', skill })
  }
  const ids = new Set(skills.map((k) => k.id as string))
  const prefix = creatureSkillPrefix(creature.ref)
  const listed = new Set(Object.values(s.tokens).flatMap((t) => t.skills ?? []))
  for (const id of Object.keys(s.customSkills)) {
    if (id.startsWith(prefix) && !ids.has(id) && !listed.has(id)) await controller.dispatch({ type: 'skill.remove', skill: id as never })
  }
  return [...ids]
}

/** Hit points for one token of a row: the override, a roll of the hit dice, or the average. */
export async function rowHp(controller: GameController, row: EncounterRow, data: Record<string, unknown>): Promise<number | undefined> {
  const config = controller.rules?.pack.manifest.creatures
  if (!config || row.overrides?.hp !== undefined || row.hpMode !== 'roll') return undefined
  const formula = hpFormula(config, data)
  if (!formula) return undefined
  try { return (await rollFromSeed(formula, newSeed())).total } catch { return undefined }
}

export interface PlacedRow {
  row: EncounterRow
  tokens: TokenId[]
}

/** Spawn every row (hidden): creatures with their stat block, plain rows as before. */
export async function placeRows(
  controller: GameController,
  rows: EncounterRow[],
  compendium: readonly CreatureEntry[] | undefined,
  templates: Record<string, CreatureTemplate> | undefined,
): Promise<{ placed: PlacedRow[]; missing: string[] }> {
  const rules = controller.rules
  const config = rules?.pack.manifest.creatures
  const hasChargen = !!rules?.pack.chargen
  const specs: SpawnSpec[] = []
  const owners: number[] = []
  const missing: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const n = Math.max(0, Math.floor(row.count || 0))
    if (!n) continue
    const creature = resolveCreature(row.creatureRef, compendium, templates)
    if (row.creatureRef && !creature) { missing.push(rowName(row)); continue }
    const names = tokenNames(rowName(row, creature), n)
    const skills = creature && config ? await syncCreatureSkills(controller, creature) : undefined
    for (const name of names) {
      if (creature && config) {
        const data = creatureSheetData(config, creature.data, row, await rowHp(controller, row, creature.data))
        specs.push({ name, color: row.color, generateSheet: false, sheet: { layout: config.sheet, data }, skills })
      } else {
        specs.push({ name, color: row.color, generateSheet: !!row.generateSheet && hasChargen })
      }
      owners.push(r)
    }
  }
  if (!specs.length) return { placed: [], missing }
  const spawned: Spawned[] = await spawnNpcs(controller, specs, { hidden: true })
  const byRow = new Map<number, TokenId[]>()
  spawned.forEach((s, i) => {
    const r = owners[i]!
    byRow.set(r, [...(byRow.get(r) ?? []), s.token.id])
  })
  return { placed: [...byRow.entries()].map(([r, tokens]) => ({ row: rows[r]!, tokens })), missing }
}

/**
 * The placed tokens join initiative as groups: one roll per row, from its first token's sheet,
 * shared by the whole row. A running order gets them merged in; otherwise a new order starts with
 * them plus the scene's visible tokens that have a sheet (the players), rolled as usual.
 */
export async function groupInitiative(controller: GameController, groups: TokenId[][]): Promise<number> {
  const s = useGame.getState()
  const live = groups.map((g) => g.filter((id) => s.tokens[id])).filter((g) => g.length)
  if (!live.length) return 0
  const seed = newSeed()
  const leaders = live.map((g) => s.tokens[g[0]!]!) as Token[]
  const rolled = await rollInitiative(leaders, s.characters, controller.rules, seed)
  const entries = live.map((tokens, i) => ({ tokens, score: rolled[i]?.score ?? 0 }))
  const init = s.initiative
  if (init?.active) {
    await controller.dispatch({ type: 'initiative.set', order: mergeGroupInitiative(init.order, entries) })
  } else {
    const joining = new Set(live.flat())
    const scene = s.meta?.activeScene
    const others = Object.values(s.tokens).filter((t) => t.scene === scene && !!t.character && !t.hidden && !joining.has(t.id))
    const base = await rollInitiative(others, s.characters, controller.rules, seed)
    await controller.dispatch({ type: 'initiative.start', order: mergeGroupInitiative(base, entries), seed })
  }
  return live.flat().length
}
