/**
 * Every roll button on every built-in sheet must resolve against a character made by that pack's
 * chargen, the way the controller resolves a `roll` intent that carries a `character`.
 */
import { describe, expect, it } from 'vitest'
import type { SheetField } from '@/core/pack'
import { createRulesEngine } from './engine'
import { BUILTIN_PACKS } from './impl'
import { loadPack } from './load'
import { SEED_A, SEED_B, fileFetch } from './test-helpers'

type RollField = Extract<SheetField, { kind: 'roll' }>

function rollFields(fields: SheetField[]): RollField[] {
  const out: RollField[] = []
  for (const f of fields) {
    if (f.kind === 'roll') out.push(f)
    else if (f.kind === 'list') out.push(...rollFields(f.item))
  }
  return out
}

describe.each(BUILTIN_PACKS)('sheet rolls: $id', ({ url }) => {
  it('every roll field evaluates against a chargen character', async () => {
    const pack = await loadPack(url, fileFetch)
    const engine = createRulesEngine(pack)
    const fields = pack.sheet.sections.flatMap((s) => rollFields(s.fields))
    expect(fields.length).toBeGreaterThan(0)
    for (const seed of [SEED_A, SEED_B]) {
      const character = await engine.generateCharacter(seed, 'Test')
      for (const field of fields) {
        const r = await engine.roll(field.formula, seed, { character })
        expect(Number.isFinite(r.total), `${field.label} (${field.formula})`).toBe(true)
        expect(r.dice.length, `${field.label} rolled no dice`).toBeGreaterThan(0)
      }
    }
  })

  it('the same formulas fail without a character, which is what the controller used to do', async () => {
    const pack = await loadPack(url, fileFetch)
    const engine = createRulesEngine(pack)
    const [field] = pack.sheet.sections.flatMap((s) => rollFields(s.fields))
    await expect(engine.roll(field.formula, SEED_A)).rejects.toThrow()
  })
})
