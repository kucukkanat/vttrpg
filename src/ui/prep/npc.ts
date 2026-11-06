/**
 * Spawning NPCs: a character (GM-owned, i.e. no owner) from the pack's chargen when asked, and a
 * token in a free cell near where the GM is looking, hidden until revealed. Shared by the NPC
 * generator and the encounter builder.
 */
import type { Character, Token } from '@/core/doc'
import type { CharacterId, TokenId } from '@/core/ids'
import { newId } from '@/core/ids'
import type { GridSpec, Vec3 } from '@/core/geometry'
import { newSeed } from '@/dice'
import { placementPoint } from '@/table'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { cellOf, freeCellsNear } from './placement'

export interface SpawnSpec {
  name: string
  color: string
  generateSheet: boolean
}

export interface Spawned {
  token: Token
  character?: Character
}

const FALLBACK_GRID: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }

/** Create the characters and tokens for `specs` in the active scene. Resolves once every intent is dispatched. */
export async function spawnNpcs(controller: GameController, specs: SpawnSpec[], opts: { hidden?: boolean } = {}): Promise<Spawned[]> {
  const s = useGame.getState()
  const sceneId = s.meta?.activeScene
  if (!sceneId) throw new Error('no active scene')
  const scene = s.scenes[sceneId]
  const grid = scene?.grid ?? FALLBACK_GRID
  const occupied: Vec3[] = Object.values(s.tokens).filter((t) => t.scene === sceneId).map((t) => t.position)
  const spots = freeCellsNear(grid, placementPoint(), occupied, specs.length)
  const rules = controller.rules
  const out: Spawned[] = []

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!
    const position = spots[i] ?? spots[spots.length - 1] ?? { x: 0, y: 0, z: 0 }
    let character: Character | undefined
    if (spec.generateSheet && rules?.pack.chargen) {
      const c = await rules.generateCharacter(newSeed(), spec.name)
      character = { ...c, id: newId<'CharacterId'>(), owner: undefined }
      await controller.dispatch({ type: 'character.upsert', character })
    }
    const token: Token = {
      id: newId<'TokenId'>(),
      scene: sceneId,
      name: spec.name,
      character: character?.id as CharacterId | undefined,
      color: spec.color,
      position,
      cell: grid.type === 'none' ? undefined : cellOf(grid, position),
      rotationY: 0,
      scale: 1,
      vision: 4,
      light: 0,
      hidden: opts.hidden ?? true,
      conditions: [],
    }
    await controller.dispatch({ type: 'token.add', token })
    out.push({ token, character })
  }
  return out
}

/** Flip `hidden` on the given tokens (those that still exist). */
export async function setHidden(controller: GameController, ids: TokenId[], hidden: boolean): Promise<void> {
  const tokens = useGame.getState().tokens
  for (const id of ids) if (tokens[id] && tokens[id]!.hidden !== hidden) await controller.dispatch({ type: 'token.update', token: id, patch: { hidden } })
}

/** Remove the given tokens and the GM-owned sheets only they used. */
export async function removeTokens(controller: GameController, ids: TokenId[]): Promise<void> {
  const s = useGame.getState()
  for (const id of ids) {
    const t = s.tokens[id]
    if (!t) continue
    await controller.dispatch({ type: 'token.remove', token: id })
    if (t.character) {
      const others = Object.values(s.tokens).some((o) => o.id !== id && o.character === t.character)
      const c = s.characters[t.character]
      if (!others && c && !c.owner) await controller.dispatch({ type: 'character.remove', character: t.character })
    }
  }
}

export interface StatLine { label: string; value: string }

function pair(v: unknown): string | null {
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object' && 'current' in v) {
    const o = v as { current?: unknown; max?: unknown }
    if (typeof o.current === 'number' && typeof o.max === 'number') return o.current === o.max ? String(o.max) : `${o.current}/${o.max}`
    if (typeof o.current === 'number') return String(o.current)
    if (typeof o.max === 'number') return String(o.max)
  }
  return null
}

/**
 * A compact stat block: non-derived attributes, resources, then any short text the chargen rolled
 * (background, birthsign, coat...) and carried item names. Pack-agnostic.
 */
export function statBlock(rules: GameController['rules'], character: Character): StatLine[] {
  const d = character.data
  const lines: StatLine[] = []
  const shown = new Set<string>(['conditions', 'notes'])
  if (rules) {
    const attrs = rules.pack.attributes.filter((a) => a.derived === undefined).map((a) => ({ label: a.abbr ?? a.name, v: pair(d[a.id]), id: a.id }))
    const a = attrs.filter((x) => x.v !== null)
    if (a.length) lines.push({ label: 'Stats', value: a.map((x) => `${x.label} ${x.v}`).join('  ') })
    for (const x of attrs) shown.add(x.id)
    const res = rules.pack.resources.map((r) => ({ label: r.name, v: pair(d[r.id]), id: r.id })).filter((x) => x.v !== null)
    for (const x of res) { lines.push({ label: x.label, value: x.v! }); shown.add(x.id) }
  }
  for (const [k, v] of Object.entries(d)) {
    if (shown.has(k)) continue
    if (typeof v === 'string' && v.trim()) lines.push({ label: title(k), value: v })
    else if (typeof v === 'number') { if (k === 'level') lines.push({ label: 'Level', value: String(v) }) }
    else if (Array.isArray(v)) {
      const names = v.map((x) => (x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : typeof x === 'string' ? x : '')).filter(Boolean)
      if (names.length) lines.push({ label: title(k), value: names.join(', ') })
    } else if (v && typeof v === 'object' && !('current' in v)) {
      const strs = Object.values(v as Record<string, unknown>).filter((x): x is string => typeof x === 'string' && !!x.trim())
      if (strs.length) lines.push({ label: title(k), value: strs.join(', ') })
    }
  }
  return lines
}

function title(k: string): string {
  return k.replace(/[-_.]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
