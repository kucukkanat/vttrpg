/**
 * Telegraph language for skill templates on the floor (TargetingLayer draws it, TargetingBar says it).
 * Colour is keyed to who owns the effect and what it does, and every colour has a shape twin, so
 * the template reads for colour-blind players too (docs/UX.md, "Telegraphs"):
 *
 * | kind    | colour     | rim                         | fill             | centre badge |
 * |---------|------------|-----------------------------|------------------|--------------|
 * | mine    | blue       | dashed aiming, solid staged | low-alpha solid  | none         |
 * | hostile | red-orange | sawtooth teeth outside      | diagonal hatch   | "!"          |
 * | help    | green      | solid, rounded dots         | "+" pattern      | "+"          |
 *
 * Any kind is dashed while aiming and solid once staged, and the fill darkens on staging. A template
 * from a caster whose turn it is not is dimmed, so the active caster's reads first. Allies inside
 * a harmful template get a warning marker and a count on the bar. Pure; no three.js.
 */
import type { TargetShape, Vec2 } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import type { ConditionDef, Effect } from '@/core/pack'
import { HELP, HOSTILE, MINE } from '@/ui/theme/palette'
import { conditionCategory } from './tokenHud'

export type SkillIntent = 'harm' | 'help' | 'neutral'
export type TelegraphKind = 'mine' | 'hostile' | 'help'
export type FillPattern = 'solid' | 'hatch' | 'plus'

/**
 * What a skill does to its targets: harm when it deals damage or forces a save, or adds a
 * condition that is not a buff; help when it only heals or adds buffs; neutral otherwise (moves,
 * messages, removing conditions).
 */
export function skillIntent(effects: readonly Effect[], conditions: readonly ConditionDef[] = []): SkillIntent {
  let help = false
  for (const e of effects) {
    if (e.kind === 'damage' || (e.kind === 'roll' && e.vs)) return 'harm'
    if (e.kind === 'heal') help = true
    if (e.kind === 'condition') {
      for (const id of e.add ?? []) {
        const category = conditionCategory(id, conditions.find((c) => c.id === id))
        if (category === 'buff') help = true
        else if (category !== 'magic') return 'harm'
      }
      if (e.remove?.length) help = true
    }
  }
  return help ? 'help' : 'neutral'
}

/** Template kind: helpful effects are green whoever casts them; otherwise the caster's side decides. */
export function telegraphKind(intent: SkillIntent | undefined, casterIsPlayer: boolean): TelegraphKind {
  if (intent === 'help') return 'help'
  return casterIsPlayer ? 'mine' : 'hostile'
}

export interface TelegraphStyle {
  kind: TelegraphKind
  color: string
  /** Rim drawn in dashes (aiming) or solid (staged). */
  dashed: boolean
  /** Sawtooth teeth outside the rim (hostile). */
  teeth: boolean
  fill: FillPattern
  fillOpacity: number
  rimOpacity: number
  badge: '!' | '+' | null
}

const BASE: Record<TelegraphKind, Pick<TelegraphStyle, 'color' | 'teeth' | 'fill' | 'badge'>> = {
  mine: { color: MINE, teeth: false, fill: 'solid', badge: null },
  hostile: { color: HOSTILE, teeth: true, fill: 'hatch', badge: '!' },
  help: { color: HELP, teeth: false, fill: 'plus', badge: '+' },
}

/** Full look of a template. `staged`: the pick waits for Cast. `dimmed`: not the caster's turn. */
export function telegraphStyle(kind: TelegraphKind, o: { staged: boolean; dimmed: boolean }): TelegraphStyle {
  const k = o.dimmed ? 0.45 : 1
  return {
    kind,
    ...BASE[kind],
    dashed: !o.staged,
    fillOpacity: (o.staged ? 0.42 : 0.24) * k,
    rimOpacity: (o.staged ? 0.95 : 0.8) * k,
  }
}

/** "1 enemy", "2 allies". */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Outcome line for the targeting bar, Into the Breach style: "hits 3 enemies, 1 ally",
 * "heals 2 allies", "hits no one". Allies and enemies are relative to the caster.
 */
export function hitSummary(intent: SkillIntent | undefined, enemies: number, allies: number): string {
  if (enemies + allies === 0) return intent === 'help' ? 'reaches no one' : 'hits no one'
  const verb = intent === 'help' ? 'heals' : intent === 'neutral' ? 'affects' : 'hits'
  const first = intent === 'help' ? [count(allies, 'ally', 'allies'), count(enemies, 'enemy', 'enemies')] : [count(enemies, 'enemy', 'enemies'), count(allies, 'ally', 'allies')]
  return `${verb} ${first.filter((s) => !s.startsWith('0 ')).join(', ')}`
}

/** Split targets into allies and enemies of the caster. `isPlayer` tells the two sides apart. */
export function sides<T extends string>(targets: readonly T[], source: T, isPlayer: (id: T) => boolean): { allies: T[]; enemies: T[] } {
  const mine = isPlayer(source)
  const allies: T[] = []
  const enemies: T[] = []
  for (const t of targets) {
    if (t === source) continue
    ;(isPlayer(t) === mine ? allies : enemies).push(t)
  }
  return { allies, enemies }
}

/** Whether a template shape is drawn as an area (with fill, rim and badge) rather than a single pick. */
export const isArea = (shape: TargetShape) => shape.kind === 'radius' || shape.kind === 'cone' || shape.kind === 'line'

/**
 * Dashes along a closed outline: segments of `dash` length with `gap` between, walking the
 * perimeter. Returns pairs of points (for line segments).
 */
export function dashSegments(points: readonly Vec2[], dash: number, gap: number): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  if (points.length < 2 || dash <= 0) return out
  const n = points.length
  let on = true
  let left = dash
  for (let i = 0; i < n; i++) {
    let a = points[i]!
    const b = points[(i + 1) % n]!
    let len = Math.hypot(b.x - a.x, b.y - a.y)
    while (len > 1e-9) {
      const step = Math.min(left, len)
      const t = step / len
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (on) out.push([a, p])
      a = p
      len -= step
      left -= step
      if (left <= 1e-9) { on = !on; left = on ? dash : gap }
    }
  }
  return out
}

/**
 * Sawtooth teeth pointing out of a closed outline (either winding): a zigzag that alternates
 * between the rim and a peak `height` outside it, about one tooth per `step` world units of
 * perimeter. Returns the zigzag as a closed loop of points.
 */
export function sawtooth(points: readonly Vec2[], step: number, height: number): Vec2[] {
  const n = points.length
  if (n < 3 || step <= 0) return []
  let area = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    area += a.x * b.y - b.x * a.y
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  if (total < 1e-9) return []
  const sign = area > 0 ? 1 : -1
  const samples = 2 * Math.max(3, Math.round(total / step))
  const out: Vec2[] = []
  let edge = 0
  let edgeStart = 0
  for (let k = 0; k < samples; k++) {
    const d = (k / samples) * total
    let a = points[edge]!
    let b = points[(edge + 1) % n]!
    let len = Math.hypot(b.x - a.x, b.y - a.y)
    while (d > edgeStart + len && edge < n - 1) {
      edgeStart += len
      edge++
      a = points[edge]!
      b = points[(edge + 1) % n]!
      len = Math.hypot(b.x - a.x, b.y - a.y)
    }
    const t = len > 1e-9 ? (d - edgeStart) / len : 0
    const ux = len > 1e-9 ? (b.x - a.x) / len : 0
    const uy = len > 1e-9 ? (b.y - a.y) / len : 0
    const lift = k % 2 === 1 ? height : 0
    out.push({ x: a.x + (b.x - a.x) * t + uy * sign * lift, y: a.y + (b.y - a.y) * t - ux * sign * lift })
  }
  return out
}

/** What the targeting bar needs from `TargetingProps` (kept structural so this file stays pure). */
export interface TargetingFacts {
  source: TokenId
  shape: TargetShape
  intent?: SkillIntent
  isPlayerCharacter?(id: TokenId): boolean
}

/**
 * The bar's outcome line for the tokens currently in the template, or null for self skills and a
 * single target not picked yet. `tone: 'ff'` when allies are caught in a harmful effect.
 */
export function targetingOutcome(t: TargetingFacts, targets: readonly TokenId[]): { text: string; tone: 'ff' | 'plain' } | null {
  if (t.shape.kind === 'self' || (t.shape.kind === 'single' && targets.length === 0)) return null
  const isPlayer = (id: TokenId) => t.isPlayerCharacter?.(id) ?? true
  const { allies, enemies } = sides(targets, t.source, isPlayer)
  const harmful = t.intent !== 'help' && t.intent !== 'neutral'
  return { text: hitSummary(t.intent, enemies.length, allies.length), tone: harmful && allies.length > 0 ? 'ff' : 'plain' }
}

/**
 * Warnings before Cast: friendly fire (allies of the caster inside a harmful effect), and, as
 * before, any other player's character among the targets of a skill that is not a heal.
 */
export function targetingWarnings(t: TargetingFacts, targets: readonly TokenId[], nameOf: (id: TokenId) => string): string[] {
  const out: string[] = []
  if (t.shape.kind === 'self' || t.intent === 'help') return out
  const isPlayer = (id: TokenId) => t.isPlayerCharacter?.(id) ?? false
  const { allies } = t.intent === 'neutral' ? { allies: [] as TokenId[] } : sides(targets, t.source, (id) => t.isPlayerCharacter?.(id) ?? true)
  if (allies.length) out.push(`Friendly fire: ${allies.map(nameOf).join(', ')}`)
  const players = targets.filter((id) => id !== t.source && isPlayer(id) && !allies.includes(id)).map(nameOf)
  if (players.length) out.push(`${players.join(', ')} ${players.length === 1 ? 'is a player character' : 'are player characters'}`)
  return out
}
