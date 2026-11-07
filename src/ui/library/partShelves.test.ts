import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CatalogueEntry } from '@/core/catalogue'
import { catalogueParts, kitPieceParts, litModelLight } from '@/core/catalogueParts'
import type { PropId, SceneId } from '@/core/ids'
import { hasModel, propSegment } from '@/core/propParts'
import { lightSourceHeld } from '@/table/build/lightSources'
import { placedProp } from '@/table/build/placement'
import { IDLE, segmentClick, segmentDrag, stretchedProp } from '@/table/build/segmentTool'
import { KAYKIT, KENNEY } from '@/table/kits/testKits'
import { LIBRARY_SHELVES } from './libraryView'
import { lightShelf, lightSourceRef, wallShelf, type ShelfPrefs } from './shelves'
import { heldFromEntry } from './useCatalogue'

const catalogue = JSON.parse(readFileSync(resolve(__dirname, '../../../public/library/catalogue.json'), 'utf8')) as CatalogueEntry[]
const prefs = (over: Partial<ShelfPrefs> = {}): ShelfPrefs => ({ query: '', filter: 'all', recent: [], favourites: [], ...over })
const byTitle = (t: string) => catalogue.find((e) => e.title === t)!
const scene = 's1' as SceneId

describe('Library shelves for lights, walls and doors', () => {
  it('adds Lights and Walls & doors after Models', () => {
    expect(LIBRARY_SHELVES.map((s) => s.id)).toEqual(['models', 'lights', 'walls', 'kit', 'creatures', 'saved'])
  })

  it('Lights: three sources, then every light-category model with a warm light', () => {
    const shelf = lightShelf(catalogue, prefs())
    expect(shelf.sources.map((s) => s.title)).toEqual(['Warm light', 'Cold light', 'Spotlight'])
    const lit = new Set(shelf.models.map((m) => m.entry.id))
    for (const e of catalogue.filter((x) => x.category === 'light')) expect(lit.has(e.id)).toBe(true)
    // Campfires and shrines outside the light category shine too.
    expect(lit.has(byTitle('Campfire logs').id)).toBe(true)
    expect(lit.has(byTitle('Barrel with goods').id)).toBe(false)
    expect(litModelLight(byTitle('Lit torch'))).toMatchObject({ radius: 6, flicker: true })
    expect(litModelLight(byTitle('Lit candle'))!.radius).toBeLessThan(litModelLight(byTitle('Starter campfire'))!.radius)
    expect(litModelLight(byTitle('Street lantern'))).toMatchObject({ radius: 6 })
  })

  it('Lights: search and favourites', () => {
    expect(lightShelf(catalogue, prefs({ query: 'candle' })).models.every((m) => /candle/i.test(`${m.entry.title} ${m.entry.tags.join(' ')}`))).toBe(true)
    expect(lightShelf(catalogue, prefs({ query: 'candle' })).sources).toEqual([])
    const fav = lightShelf(catalogue, prefs({ filter: 'favourites', favourites: [lightSourceRef('spot'), byTitle('Lit torch').id] }))
    expect(fav.sources.map((s) => s.id)).toEqual(['spot'])
    expect(fav.models.map((m) => m.entry.title)).toEqual(['Lit torch'])
  })

  it('Walls & doors: the invisible pair, wall and door models, kit walls as props', () => {
    const shelf = wallShelf(catalogue, [KAYKIT, KENNEY], prefs())
    expect(shelf.invisible.map((s) => s.id)).toEqual(['wall', 'door'])
    const models = new Map(shelf.models.map((m) => [m.entry.title, m.parts]))
    expect(models.get('Castle door')).toEqual({ door: { open: false } })
    expect(models.get('Portcullis')).toEqual({ door: { open: false } })
    expect(models.get('Palisade')).toEqual({ wall: { blocks: 'both' } })
    expect(models.get('Iron fence')).toEqual({ wall: { blocks: 'move' } })
    expect(models.get('Low stone wall')).toEqual({ wall: { blocks: 'move' } })
    // Shelves and banners with a "wall" tag are decor, not walls; nor are torches.
    expect(models.has('Wall shelves')).toBe(false)
    expect(models.has('Wall torch')).toBe(false)
    const kit = new Map(shelf.kit.map((k) => [`${k.kit}/${k.piece.id}`, k.parts]))
    expect(kit.get('kaykit-dungeon/wall')).toEqual({ wall: { blocks: 'both' } })
    expect(kit.get('kaykit-dungeon/wall-doorway')).toEqual({ wall: { blocks: 'both' }, door: { open: false } })
    expect(kit.get('kaykit-dungeon/wall-window-open')).toEqual({ wall: { blocks: 'move' } })
    expect(kit.get('kenney-town/balcony-wall-fence')).toEqual({ wall: { blocks: 'move' } })
    expect(kit.has('kenney-town/wall-arch')).toBe(false) // no gameplay walls
    expect(kit.has('kaykit-dungeon/floor')).toBe(false)
  })

  it('kit pieces that are not one straight run carry nothing', () => {
    for (const p of [...KAYKIT.pieces, ...KENNEY.pieces].filter((x) => x.arms?.length)) expect(kitPieceParts(p)).toBeUndefined()
  })
})

describe('placing parts', () => {
  it('a lit model carries its light; a door model its door', () => {
    const torch = placedProp({ id: 'p' as PropId, scene, held: heldFromEntry(byTitle('Lit torch')), at: { x: 0, y: 0, z: 0 }, yaw: 0 })
    expect(torch.light).toMatchObject({ color: '#ffa040', radius: 6, flicker: true })
    const door = placedProp({ id: 'd' as PropId, scene, held: heldFromEntry(byTitle('Castle door')), at: { x: 0, y: 0, z: 0 }, yaw: 0 })
    expect(door.door).toEqual({ open: false })
    const barrel = placedProp({ id: 'b' as PropId, scene, held: heldFromEntry(byTitle('Barrel with goods')), at: { x: 0, y: 0, z: 0 }, yaw: 0 })
    expect(barrel.light ?? barrel.wall ?? barrel.door).toBeUndefined()
    expect(catalogueParts(catalogue.find((e) => e.id === 'builtin:kits/kaykit-dungeon/wall.glb')!)).toBeUndefined() // kit pieces take theirs from the manifest
  })

  it('a light source places an invisible light prop, and stamps never share a part object', () => {
    const held = lightSourceHeld('cold')
    const a = placedProp({ id: 'a' as PropId, scene, held, at: { x: 1, y: 0, z: 2 }, yaw: 0 })
    const b = placedProp({ id: 'b' as PropId, scene, held, at: { x: 3, y: 0, z: 2 }, yaw: 0 })
    expect(hasModel(a)).toBe(false)
    expect(a.light).toEqual({ color: '#9cc8ff', radius: 6 })
    expect(a.light).not.toBe(b.light)
  })
})

describe('the invisible wall tool', () => {
  it('starts on the first click, places on the second and chains from its end', () => {
    let r = segmentClick('wall', IDLE, { x: 0, z: 0 })
    expect(r.place).toBeNull()
    r = segmentClick('wall', r.state, { x: 3, z: 0 })
    expect(r.place).toEqual({ a: { x: 0, z: 0 }, b: { x: 3, z: 0 } })
    expect(r.state.start).toEqual({ x: 3, z: 0 })
    r = segmentClick('wall', r.state, { x: 3, z: 4.5 })
    expect(r.place).toEqual({ a: { x: 3, z: 0 }, b: { x: 3, z: 4.5 } })
    // A click on the same spot places nothing and keeps the chain.
    expect(segmentClick('wall', r.state, { x: 3, z: 4.5 }).place).toBeNull()
  })

  it('a door is one stretch, by drag or two clicks', () => {
    const r1 = segmentClick('door', IDLE, { x: 0, z: 0 })
    const r2 = segmentClick('door', r1.state, { x: 1.5, z: 0 })
    expect(r2.place).not.toBeNull()
    expect(r2.state).toBe(IDLE)
    expect(segmentDrag({ x: 0, z: 0 }, { x: 0, z: 0.01 })).toBeNull()
    expect(segmentDrag({ x: 0, z: 0 }, { x: 0, z: 1.5 })).toEqual({ a: { x: 0, z: 0 }, b: { x: 0, z: 1.5 } })
  })

  it('the placed prop spans exactly the clicked ends', () => {
    const a = { x: -1.5, z: 0.75 }, b = { x: 3, z: 6.75 }
    const wall = stretchedProp('wall', { a, b }, scene, 0, 'w' as PropId)
    expect(hasModel(wall)).toBe(false)
    expect(wall.wall!.blocks).toBe('both')
    const seg = propSegment(wall, undefined, 1.5)!
    expect(seg).toEqual({ a, b })
    const door = stretchedProp('door', { a, b }, scene, 0, 'd' as PropId)
    expect(door.door).toMatchObject({ open: false })
    expect(propSegment(door, undefined, 1.5)).toEqual({ a, b })
  })
})
