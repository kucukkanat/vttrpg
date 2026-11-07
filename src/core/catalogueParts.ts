/**
 * The parts a model carries when it is placed (src/core/propParts.ts): lit models (torches,
 * candles, lanterns, campfires, braziers) shine, door and gate models open and close, wall,
 * palisade and fence models block. Kit pieces placed as props take theirs from the kit's own wall
 * data. Pure.
 */
import type { CatalogueEntry } from './catalogue'
import type { Prop, PropLight } from './doc'
import type { KitPiece } from './kits'

/** The kind-specific parts of a prop, as a held model carries them to every prop it stamps. */
export type PropParts = Pick<Prop, 'light' | 'wall' | 'door'>

type Entry = Pick<CatalogueEntry, 'category' | 'tags' | 'title' | 'size'> & { kit?: string | undefined }

const words = (e: Entry) => new Set([...(e.tags ?? []), ...e.title.toLowerCase().split(/[^a-z']+/)].map((t) => t.toLowerCase()))

/** Warm light presets by what burns, first match wins. Reach in cells. */
const LIT: { any: string[]; light: PropLight }[] = [
  { any: ['campfire', 'bonfire', 'hearth'], light: { color: '#ff9a3c', radius: 8, intensity: 1.2, flicker: true } },
  { any: ['brazier', 'torch', 'sconce'], light: { color: '#ffa040', radius: 6, flicker: true } },
  { any: ['jack', 'pumpkin'], light: { color: '#ff8a2a', radius: 3, flicker: true } },
  { any: ['candle', 'candles', 'candelabra'], light: { color: '#ffb35c', radius: 2, intensity: 0.8, flicker: true } },
  { any: ['streetlight', 'lamppost'], light: { color: '#ffd08a', radius: 6 } },
  { any: ['lantern', 'lamp'], light: { color: '#ffc070', radius: 4, flicker: true } },
  { any: ['fire', 'flame'], light: { color: '#ff9a3c', radius: 6, flicker: true } },
]

/** The light a lit model carries, or undefined for a model that does not shine. */
export function litModelLight(e: Entry): PropLight | undefined {
  const w = words(e)
  const lightish = e.category === 'light' || ['campfire', 'bonfire', 'brazier', 'candle', 'torch'].some((t) => w.has(t))
  if (!lightish) return undefined
  for (const p of LIT) if (p.any.some((t) => w.has(t))) return { ...p.light }
  return { color: '#ffb35c', radius: 4, flicker: true }
}

/** Taller than this (metres) a wall model blocks sight; lower ones (a low wall, a fence) only movement. */
export const SIGHT_HEIGHT = 1.8

/**
 * The parts a catalogue model carries when placed: a light for lit models, a door for door, gate
 * and portcullis models, a wall for walls, palisades and fences. Kit pieces get theirs from
 * `kitPieceParts`. Undefined for everything else.
 */
export function catalogueParts(e: Entry): PropParts | undefined {
  if (e.kit || e.category === 'kit') return undefined
  const light = litModelLight(e)
  if (light) return { light }
  if (e.category !== 'structure') return undefined
  const w = words(e)
  if (['door', 'gate', 'portcullis'].some((t) => w.has(t))) return { door: { open: false } }
  const tall = (e.size?.[1] ?? 0) >= SIGHT_HEIGHT
  if (w.has('palisade') || w.has('stockade') || (w.has('wall') && tall)) return { wall: { blocks: 'both' } }
  if (['wall', 'fence', 'railing', 'barrier'].some((t) => w.has(t))) return { wall: { blocks: 'move' } }
  return undefined
}

/** True when a catalogue model is a wall or door (the Walls & doors shelf lists it). */
export function isWallOrDoorEntry(e: Entry): boolean {
  const p = catalogueParts(e)
  return !!(p?.wall || p?.door)
}

/**
 * A kit piece placed as a prop: a doorway is a wall with a door in it, a window or a balcony rail
 * stops movement only, a solid wall blocks both. Pieces without gameplay walls (arches, overhangs)
 * and pieces that are not one straight run (corners, crossings) carry nothing.
 */
export function kitPieceParts(p: Pick<KitPiece, 'slot' | 'los' | 'arms'>): PropParts | undefined {
  if (p.arms?.length) return undefined
  if (p.slot === 'door') return { wall: { blocks: 'both' }, door: { open: false } }
  if (p.slot === 'window') return { wall: { blocks: 'move' } }
  if (p.slot !== 'wall' || !p.los.length) return undefined
  return p.los.every((s) => s.kind === 'window') ? { wall: { blocks: 'move' } } : { wall: { blocks: 'both' } }
}

/** A copy of a prop's parts (for the eyedropper and the clipboard). */
export function partsOf(p: PropParts): PropParts | undefined {
  const out: PropParts = {}
  if (p.light) out.light = { ...p.light }
  if (p.wall) out.wall = { ...p.wall }
  if (p.door) out.door = { ...p.door }
  return out.light || out.wall || out.door ? out : undefined
}
