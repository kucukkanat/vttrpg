/** Test-only helpers: a file-backed fetch for pack loading and fixture characters. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Character } from '@/core/doc'
import type { CharacterId } from '@/core/ids'
import type { LoadedPack } from './index'
import { loadPack, type FetchLike } from './load'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/** Serves `packs/<id>/...` URLs from the repository checkout. */
export const fileFetch: FetchLike = async (url) => {
  try {
    const text = await readFile(repoRoot + url.replace(/^\.?\//, ''), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

let cached: Promise<LoadedPack> | undefined
export function loadMausritter(): Promise<LoadedPack> {
  cached ??= loadPack('packs/mausritter/', fileFetch)
  return cached
}

export const SEED_A = '0123456789abcdef'.repeat(4)
export const SEED_B = 'fedcba9876543210'.repeat(4)

export function mouse(
  id: string,
  name: string,
  overrides: Partial<{ str: number; dex: number; wil: number; hp: number; hpMax: number; items: unknown[]; conditions: string[] }> = {},
  owner?: string,
): Character {
  const stat = (n: number) => ({ current: n, max: n })
  const inventory: unknown[] = new Array<unknown>(10).fill(null)
  ;(overrides.items ?? []).forEach((it, i) => (inventory[i] = it))
  return {
    id: id as CharacterId,
    name,
    owner: owner as Character['owner'],
    data: {
      str: stat(overrides.str ?? 9),
      dex: stat(overrides.dex ?? 9),
      wil: stat(overrides.wil ?? 9),
      hp: { current: overrides.hp ?? 6, max: overrides.hpMax ?? overrides.hp ?? 6 },
      pips: { current: 3, max: 250 },
      inventory,
      conditions: overrides.conditions ?? [],
      notes: '',
    },
  }
}
