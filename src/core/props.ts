/**
 * Prop model v2 helpers: reading a prop's scale (including version 1 props), the scale
 * migration, validation of the `props.*` batch intents, and the comparisons the undo stack uses.
 * Pure: no three.js, no Yjs.
 *
 * ## The scale migration
 *
 * Version 1 stored `scale` as one number and drew the model "fitted": on every load the renderer
 * measured the model's widest horizontal extent and, when it was wider than one cell (or narrower
 * than a tenth of one), scaled it to that bound before applying `scale`
 * (`legacyPropFit` in src/table/fitScale.ts). So what a number meant depended on the model's
 * bounds and on the scene's cell size, which only a client that has loaded the model knows.
 *
 * Version 2 draws every model at its real size times a per-axis `scale`. To keep an old prop's
 * exact on-screen size, its number `n` becomes `[n * fit, n * fit, n * fit]` with the same `fit`
 * the old renderer used. That happens in two places:
 *
 * - Reading: until the document is migrated, renderers call `propScale(prop, fit)` with the fit
 *   they computed from the loaded model, which gives the same size as before.
 * - Writing, once: a GM client that has loaded the model sends `props.migrate` with that fit.
 *   Apply replaces the number only while it is still a number (so two GM clients racing write the
 *   same thing once) and records the factor as `legacyFit`. After that the prop is a plain v2 prop
 *   and no fit is ever applied again.
 */
import type { GameDocShape, Prop, Wall } from './doc'
import type { Vec3 } from './geometry'
import type { Intent, PropPatch } from './intents'
import type { PropId } from './ids'

/** Per-axis scale the validator accepts. Wide on purpose: migrated props of huge models get tiny scales. */
export const PROP_SCALE_LIMITS = { min: 1e-4, max: 1e4 } as const
/** Positions further out than this (metres) are refused. */
export const PROP_POSITION_LIMIT = 1e5
/** Most props one intent may place, update or remove. */
export const MAX_PROPS_PER_INTENT = 5000
/** Fields `props.update` may patch. */
export const PROP_PATCH_KEYS = ['position', 'rotation', 'scale', 'name', 'solid', 'locked'] as const satisfies readonly (keyof PropPatch)[]

export const ONE_SCALE: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 }) as Vec3

export function isLegacyScale(scale: Prop['scale']): scale is number {
  return typeof scale === 'number'
}

/**
 * The scale to draw `prop` with on its real-size model. A version 1 number is multiplied by
 * `legacyFit`, the one-cell fit of the loaded model (1 while unknown, e.g. still loading).
 */
export function propScale(prop: Pick<Prop, 'scale'>, legacyFit = 1): Vec3 {
  const s = prop.scale
  if (isLegacyScale(s)) return migratedScale(s, legacyFit)
  return s
}

/** The v2 scale of a version 1 prop: its uniform number times the fit it used to be drawn with. */
export function migratedScale(n: number, fit: number): Vec3 {
  const k = n * fit
  return { x: k, y: k, z: k }
}

/** One number for a per-axis scale (the largest axis), for uniform handles and summaries. */
export function uniformScale(v: Vec3): number {
  return Math.max(v.x, v.y, v.z)
}

export function scaleBy(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k }
}

export function isUniform(v: Vec3, eps = 1e-9): boolean {
  return Math.abs(v.x - v.y) <= eps && Math.abs(v.y - v.z) <= eps
}

// ------------------------------------------------------------- validation

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec = (v: unknown): v is Vec3 =>
  !!v && typeof v === 'object' && finite((v as Vec3).x) && finite((v as Vec3).y) && finite((v as Vec3).z)

function badPosition(v: unknown): string | null {
  if (!isVec(v)) return 'position must be three finite numbers'
  return Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) > PROP_POSITION_LIMIT ? 'position is too far out' : null
}

function badRotation(v: unknown): string | null {
  return isVec(v) ? null : 'rotation must be three finite numbers'
}

function badScaleNumber(n: number): boolean {
  return !finite(n) || n < PROP_SCALE_LIMITS.min || n > PROP_SCALE_LIMITS.max
}

function badScale(v: unknown, allowLegacy: boolean): string | null {
  if (allowLegacy && typeof v === 'number') return badScaleNumber(v) ? 'scale out of range' : null
  if (!isVec(v)) return 'scale must be three finite numbers'
  return badScaleNumber(v.x) || badScaleNumber(v.y) || badScaleNumber(v.z) ? 'scale out of range' : null
}

function badNewProp(p: unknown, doc: Pick<GameDocShape, 'scenes'>): string | null {
  if (!p || typeof p !== 'object') return 'not a prop'
  const prop = p as Prop
  if (typeof prop.id !== 'string' || !prop.id) return 'prop without an id'
  if (typeof prop.scene !== 'string' || !doc.scenes?.[prop.scene]) return 'unknown scene'
  if (typeof prop.name !== 'string') return 'prop without a name'
  if (!prop.model || typeof prop.model !== 'object' || typeof prop.model.sha256 !== 'string') return 'prop without a model'
  // Re-placing a version 1 prop (undo of a removal, a stamp of an old prefab) keeps its number.
  const bad = badPosition(prop.position) ?? badRotation(prop.rotation) ?? badScale(prop.scale, true)
  if (bad) return bad
  if (prop.catalogue !== undefined && typeof prop.catalogue !== 'string') return 'catalogue must be an id'
  if (prop.tags !== undefined && (!Array.isArray(prop.tags) || prop.tags.length > 64 || prop.tags.some((t) => typeof t !== 'string'))) return 'tags must be a list of words'
  if (prop.solid !== undefined && typeof prop.solid !== 'boolean') return 'solid must be true or false'
  if (prop.locked !== undefined && typeof prop.locked !== 'boolean') return 'locked must be true or false'
  return null
}

function badWall(w: unknown, doc: Pick<GameDocShape, 'scenes'>): string | null {
  const wall = w as Wall
  if (!wall || typeof wall !== 'object' || typeof wall.id !== 'string' || !wall.id) return 'wall without an id'
  if (!doc.scenes?.[wall.scene]) return 'wall in an unknown scene'
  const pt = (q: unknown) => !!q && finite((q as { x: number }).x) && finite((q as { z: number }).z)
  return pt(wall.a) && pt(wall.b) ? null : 'wall ends must be finite'
}

/** Why `patch` is not a valid `props.update` patch, or null. */
export function badPatch(patch: unknown): string | null {
  if (!patch || typeof patch !== 'object') return 'patch must be an object'
  const keys = Object.keys(patch)
  for (const k of keys) if (!(PROP_PATCH_KEYS as readonly string[]).includes(k)) return `cannot change ${k}`
  const p = patch as PropPatch
  if (p.position !== undefined) { const b = badPosition(p.position); if (b) return b }
  if (p.rotation !== undefined) { const b = badRotation(p.rotation); if (b) return b }
  if (p.scale !== undefined) { const b = badScale(p.scale, false); if (b) return b }
  if (p.name !== undefined && typeof p.name !== 'string') return 'name must be text'
  if (p.solid !== undefined && typeof p.solid !== 'boolean') return 'solid must be true or false'
  if (p.locked !== undefined && typeof p.locked !== 'boolean') return 'locked must be true or false'
  return null
}

function badBatch(list: unknown, what: string): string | null {
  if (!Array.isArray(list) || list.length === 0) return `nothing to ${what}`
  return list.length > MAX_PROPS_PER_INTENT ? `too many props in one ${what} (max ${MAX_PROPS_PER_INTENT})` : null
}

/** The scene a prop lives in must still exist for it to be edited. */
function badExisting(id: unknown, doc: Pick<GameDocShape, 'props' | 'scenes'>): string | null {
  const prop = typeof id === 'string' ? doc.props?.[id as PropId] : undefined
  if (!prop) return 'unknown prop'
  return doc.scenes?.[prop.scene] ? null : 'that prop is not in a scene'
}

const duplicates = (ids: unknown[]) => new Set(ids).size !== ids.length

/**
 * Shape and reference checks for the prop intents, run for the GM and co-GMs too (permission is
 * the engine's job). Null when valid or when `intent` is not a prop intent. All or nothing: one
 * bad entry refuses the whole batch.
 */
export function validatePropsIntent(intent: Intent, doc: Pick<GameDocShape, 'props' | 'scenes'>): string | null {
  switch (intent.type) {
    case 'props.place': {
      const b = badBatch(intent.props, 'place')
      if (b) return b
      for (const p of intent.props) {
        const bad = badNewProp(p, doc)
        if (bad) return bad
        if (doc.props?.[p.id]) return 'a prop with that id already exists'
      }
      if (duplicates(intent.props.map((p) => p.id))) return 'the same prop twice in one batch'
      if (intent.walls !== undefined) {
        if (!Array.isArray(intent.walls) || intent.walls.length > MAX_PROPS_PER_INTENT) return 'walls must be a list'
        for (const w of intent.walls) { const bad = badWall(w, doc); if (bad) return bad }
      }
      return null
    }
    case 'props.update': {
      const b = badBatch(intent.updates, 'update')
      if (b) return b
      for (const u of intent.updates) {
        if (!u || typeof u !== 'object') return 'not an update'
        const bad = badExisting(u.id, doc) ?? badPatch(u.patch)
        if (bad) return bad
      }
      return duplicates(intent.updates.map((u) => u.id)) ? 'the same prop twice in one batch' : null
    }
    case 'props.remove': {
      const b = badBatch(intent.ids, 'remove')
      if (b) return b
      for (const id of intent.ids) { const bad = badExisting(id, doc); if (bad) return bad }
      return duplicates(intent.ids) ? 'the same prop twice in one batch' : null
    }
    case 'props.migrate': {
      const b = badBatch(intent.items, 'migrate')
      if (b) return b
      for (const it of intent.items) {
        if (!it || typeof it !== 'object' || !doc.props?.[it.id]) return 'unknown prop'
        if (!finite(it.fit) || it.fit <= 0 || it.fit > PROP_SCALE_LIMITS.max) return 'fit out of range'
      }
      return null
    }
    case 'prop.add':
      return validatePropsIntent({ type: 'props.place', props: [intent.prop] }, doc)
    case 'prop.update': {
      const bad = badExisting(intent.prop, doc)
      if (bad) return bad
      // Older clients may still send a number scale; everything else follows the batch rules.
      const { scale, ...rest } = (intent.patch ?? {}) as Partial<Prop>
      const allowed = Object.fromEntries(Object.entries(rest).filter(([k]) => (PROP_PATCH_KEYS as readonly string[]).includes(k)))
      if (scale !== undefined) { const b = badScale(scale, true); if (b) return b }
      return badPatch(allowed)
    }
    case 'prop.remove':
      return badExisting(intent.prop, doc)
    default:
      return null
  }
}

// ------------------------------------------------------------- comparisons

/**
 * A prop reduced to what the undo stack compares: everything except `legacyFit`, with a
 * version 1 scale replaced by its migrated vector when the migration has recorded the factor.
 * So the one-off migration does not look like "someone else changed this".
 */
function comparable(p: Prop, fit: number | undefined): Record<string, unknown> {
  const { legacyFit: _fit, ...rest } = p
  const f = fit ?? p.legacyFit
  if (isLegacyScale(rest.scale) && f !== undefined) return { ...rest, scale: migratedScale(rest.scale, f) }
  return rest
}

/** Deep-equal JSON values (plain objects, arrays, primitives). Key order does not matter. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : false
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]))
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * True when the document's `current` prop is still the state `expected` (both absent counts).
 * Used by undo/redo to skip props someone else changed since: their edit changes the content and
 * stamps their pubkey as `editedBy`, so it never matches.
 */
export function samePropState(current: Prop | null | undefined, expected: Prop | null | undefined): boolean {
  if (!current || !expected) return !current && !expected
  const fit = current.legacyFit ?? expected.legacyFit
  return sameJson(comparable(current, fit), comparable(expected, fit))
}

/**
 * The `props.update` patch that turns `current` into `target` (the fields a patch can carry), or
 * null when nothing differs. A flag missing on `target` is written as `false`. A version 1 scale
 * on `target` is converted with the migration factor when one is known.
 */
export function patchToward(current: Prop, target: Prop): PropPatch | null {
  const patch: PropPatch = {}
  if (!sameJson(current.position, target.position)) patch.position = { ...target.position }
  if (!sameJson(current.rotation, target.rotation)) patch.rotation = { ...target.rotation }
  if (current.name !== target.name) patch.name = target.name
  if (!!current.solid !== !!target.solid) patch.solid = !!target.solid
  if (!!current.locked !== !!target.locked) patch.locked = !!target.locked
  const fit = current.legacyFit ?? target.legacyFit
  const want = isLegacyScale(target.scale) ? (fit !== undefined ? migratedScale(target.scale, fit) : null) : target.scale
  const have = isLegacyScale(current.scale) ? (fit !== undefined ? migratedScale(current.scale, fit) : null) : current.scale
  if (want && !sameJson(want, have)) patch.scale = { ...want }
  return Object.keys(patch).length ? patch : null
}
