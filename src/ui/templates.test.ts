import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Character } from '@/core/doc'
import type { CharacterId, PlayerPubkey } from '@/core/ids'
import type { Intent } from '@/core/intents'
import type { LibraryEntry } from '@/assets'
import { BUILTIN_PACKS } from '@/rules'
import { interpretScene } from '@/table/sceneLoader'
import {
  TEMPLATES, applyTemplate, findSceneEntry, sceneAssetRef, spawnOffset, templateById, type TemplateController,
} from './templates'

const LIBRARY = resolve(__dirname, '../../public/library')
const index = JSON.parse(readFileSync(resolve(LIBRARY, 'index.json'), 'utf8')) as LibraryEntry[]
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey

async function parseGlb(path: string): Promise<GLTF> {
  const bytes = readFileSync(resolve(LIBRARY, path))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((ok, err) => new GLTFLoader().parse(buffer, '', ok, err))
}

function fakeController(opts: { rules?: boolean } = {}) {
  const intents: Intent[] = []
  let n = 0
  const controller: TemplateController = {
    pubkey: GM,
    rules: opts.rules === false ? null : {
      async generateCharacter(seed: string, name: string): Promise<Character> {
        n++
        return { id: `mausritter-${seed.slice(0, 12)}` as CharacterId, name: `${name} (rolled ${n})`, data: { str: { current: 9, max: 9 } } }
      },
    },
    async dispatch(intent) { intents.push(intent) },
  }
  return { controller, intents }
}

describe('template list', () => {
  it('has unique ids, known packs and spawns for every starter token', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['mausritter-tavern', 'mausritter-dungeon', 'mausritter-forest', 'empty'])
    for (const t of TEMPLATES) {
      expect(BUILTIN_PACKS.some((p) => p.id === t.packId)).toBe(true)
      expect(t.description.length).toBeLessThan(100)
      expect(t.darkness).toBeGreaterThanOrEqual(0)
      expect(t.darkness).toBeLessThanOrEqual(1)
      for (const s of t.starterTokens) expect(t.spawns[s.spawn], `${t.id}: spawn ${s.spawn}`).toBeDefined()
      if (t.sceneFile) expect(t.grid, `${t.id}: grid`).toBeDefined()
    }
    expect(templateById('empty')?.sceneFile).toBeUndefined()
    expect(templateById('nope')).toBeUndefined()
  })

  it('gives every Mausritter template three mice with sheets', () => {
    for (const t of TEMPLATES.filter((t) => t.id.startsWith('mausritter-'))) {
      const mice = t.starterTokens.filter((s) => s.generateCharacter)
      expect(mice, t.id).toHaveLength(3)
      for (const m of mice) expect(m.owner).toBe('player')
    }
    expect(templateById('mausritter-tavern')!.starterTokens.map((s) => s.spawn)).toEqual(['player', 'player', 'player', 'barkeep'])
    expect(templateById('mausritter-dungeon')!.starterTokens.filter((s) => s.spawn.startsWith('enemy_'))).toHaveLength(2)
  })
})

describe('library lookup', () => {
  it('finds every scene in public/library/index.json by path with a sha256', () => {
    for (const t of TEMPLATES) {
      const entry = findSceneEntry(index, t)
      if (!t.sceneFile) { expect(entry).toBeUndefined(); continue }
      expect(entry, t.sceneFile).toBeDefined()
      expect(entry!.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(entry!.kind).toBe('glb')
      expect(entry!.size).toBeLessThan(500 * 1024)
    }
  })

  it('builds an AssetRef whose source is the library URL', () => {
    const entry = findSceneEntry(index, templateById('mausritter-tavern')!)!
    const ref = sceneAssetRef(entry, 'https://kucukkanat.github.io/vttrpg/#/new')
    expect(ref.sha256).toBe(entry.sha256)
    expect(ref.kind).toBe('glb')
    expect(ref.mime).toBe('model/gltf-binary')
    expect(ref.sources).toEqual([`https://kucukkanat.github.io${import.meta.env.BASE_URL}library/scenes/tavern.glb`])
  })
})

describe('hardcoded spawns and grids match the generated scenes', () => {
  for (const t of TEMPLATES.filter((t) => t.sceneFile)) {
    it(t.id, async () => {
      const loaded = interpretScene(await parseGlb(t.sceneFile!))
      expect(loaded.grid!.type).toBe(t.grid!.type)
      expect(loaded.grid!.cellSize).toBe(t.grid!.cellSize)
      expect(loaded.grid!.origin.x).toBeCloseTo(t.grid!.origin.x, 5)
      expect(loaded.grid!.origin.z).toBeCloseTo(t.grid!.origin.z, 5)
      expect(Object.keys(loaded.spawns).sort()).toEqual(Object.keys(t.spawns).sort())
      for (const [k, v] of Object.entries(t.spawns)) {
        expect(loaded.spawns[k]!.x, `${t.id} ${k}.x`).toBeCloseTo(v.x, 5)
        expect(loaded.spawns[k]!.y, `${t.id} ${k}.y`).toBeCloseTo(v.y, 5)
        expect(loaded.spawns[k]!.z, `${t.id} ${k}.z`).toBeCloseTo(v.z, 5)
      }
    })
  }
})

describe('spawnOffset', () => {
  it('keeps the first token on the spawn and fans the rest out by one cell', () => {
    expect(spawnOffset(0, 1.5)).toEqual({ x: 0, y: 0, z: 0 })
    expect(spawnOffset(1, 1.5)).toEqual({ x: 1.5, y: 0, z: 0 })
    expect(spawnOffset(2, 1.5)).toEqual({ x: -1.5, y: 0, z: 0 })
    const seen = new Set(Array.from({ length: 9 }, (_, i) => JSON.stringify(spawnOffset(i, 1))))
    expect(seen.size).toBe(9)
  })
})

describe('applyTemplate', () => {
  it('does nothing for the empty table', async () => {
    const { controller, intents } = fakeController()
    const r = await applyTemplate(controller, templateById('empty')!, { index })
    expect(intents).toEqual([])
    expect(r).toEqual({ sceneId: null, tokens: [], characters: [] })
  })

  it('adds and activates the scene, then tokens, sheets and links in order', async () => {
    const { controller, intents } = fakeController()
    const progress: string[] = []
    const t = templateById('mausritter-tavern')!
    const r = await applyTemplate(controller, t, { index, baseHref: 'http://localhost:5173/', onProgress: (s) => progress.push(s) })

    expect(intents.map((i) => i.type)).toEqual([
      'scene.add', 'scene.activate',
      'token.add', 'character.upsert', 'token.update',
      'token.add', 'character.upsert', 'token.update',
      'token.add', 'character.upsert', 'token.update',
      'token.add',
    ])
    const add = intents[0] as Extract<Intent, { type: 'scene.add' }>
    expect(add.scene.id).toBe(r.sceneId)
    expect(add.scene.name).toBe('The Thistle & Thimble')
    expect(add.scene.model!.sha256).toBe(findSceneEntry(index, t)!.sha256)
    expect(add.scene.model!.sources).toEqual(['http://localhost:5173/library/scenes/tavern.glb'])
    expect(add.scene.grid).toEqual(t.grid)
    expect(add.scene.cameraMode).toBe('orbit')
    expect(add.scene.darkness).toBe(0.7)
    expect(add.scene.ambientPreset).toBe('tavern')
    expect(add.scene.weather).toBe('none')
    expect((intents[1] as Extract<Intent, { type: 'scene.activate' }>).scene).toBe(r.sceneId)

    const tokens = intents.filter((i): i is Extract<Intent, { type: 'token.add' }> => i.type === 'token.add').map((i) => i.token)
    expect(tokens).toHaveLength(4)
    expect(r.tokens).toEqual(tokens.map((tk) => tk.id))
    for (const tk of tokens) expect(tk.scene).toBe(r.sceneId)
    // Three mice fan out from SPAWN_player; the barkeep stands behind the counter and belongs to the GM.
    expect(tokens.slice(0, 3).map((tk) => tk.position)).toEqual([
      { x: -3.75, y: 0, z: 2.25 }, { x: -2.25, y: 0, z: 2.25 }, { x: -5.25, y: 0, z: 2.25 },
    ])
    for (const tk of tokens.slice(0, 3)) expect(tk.owner).toBeUndefined()
    expect(tokens[3]).toMatchObject({ name: 'Old Barley', owner: GM, position: { x: 5.25, y: 0, z: -0.75 }, vision: 3 })

    const sheets = intents.filter((i): i is Extract<Intent, { type: 'character.upsert' }> => i.type === 'character.upsert').map((i) => i.character)
    expect(sheets.map((c) => c.name)).toEqual(['Pip Thistledown', 'Bramble Oakhollow', 'Nettle Quickwhisker'])
    expect(new Set(sheets.map((c) => c.id)).size).toBe(3)
    for (const c of sheets) expect(c.owner).toBeUndefined()
    expect(r.characters).toEqual(sheets.map((c) => c.id))

    const links = intents.filter((i): i is Extract<Intent, { type: 'token.update' }> => i.type === 'token.update')
    expect(links.map((l) => [l.token, l.patch.character])).toEqual(sheets.map((c, i) => [tokens[i]!.id, c.id]))

    expect(progress[0]).toMatch(/library/)
    expect(progress).toContain('Rolling up Pip Thistledown…')
    expect(progress.at(-1)).toBe('Opening the table…')
  })

  it('places tokens without sheets when no rules engine is loaded', async () => {
    const { controller, intents } = fakeController({ rules: false })
    const r = await applyTemplate(controller, templateById('mausritter-dungeon')!, { index, baseHref: 'http://localhost/' })
    expect(intents.map((i) => i.type)).toEqual(['scene.add', 'scene.activate', 'token.add', 'token.add', 'token.add', 'token.add', 'token.add'])
    expect(r.characters).toEqual([])
    expect(r.tokens).toHaveLength(5)
    // Mice line up along the one-cell-wide entrance corridor instead of fanning out sideways.
    const mice = intents.filter((i): i is Extract<Intent, { type: 'token.add' }> => i.type === 'token.add').slice(0, 3).map((i) => i.token.position)
    expect(mice).toEqual([{ x: 0, y: 0, z: 8.25 }, { x: 0, y: 0, z: 6.75 }, { x: 0, y: 0, z: 5.25 }])
  })

  it('uses the forest hex grid and both spawns', async () => {
    const { controller, intents } = fakeController({ rules: false })
    await applyTemplate(controller, templateById('mausritter-forest')!, { index, baseHref: 'http://localhost/' })
    const add = intents[0] as Extract<Intent, { type: 'scene.add' }>
    expect(add.scene.grid.type).toBe('hex')
    const tokens = intents.filter((i): i is Extract<Intent, { type: 'token.add' }> => i.type === 'token.add').map((i) => i.token)
    expect(tokens[0]!.position.x).toBeCloseTo(0.75)
    expect(tokens[1]!.position.x).toBeCloseTo(-0.75)
    expect(tokens[2]!.position.x).toBeCloseTo(2.25) // second mouse on SPAWN_player, one cell east
  })

  it('fails clearly when the scene is missing from the index', async () => {
    const { controller, intents } = fakeController()
    await expect(applyTemplate(controller, templateById('mausritter-tavern')!, { index: [] })).rejects.toThrow(/not in the library index/)
    expect(intents).toEqual([])
  })
})
