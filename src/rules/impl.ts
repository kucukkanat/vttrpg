// TODO(rules session): implement. See src/rules/index.ts for the contract and packs/mausritter.
import type { LoadedPack, RulesEngine } from './index'

/** Built-in packs are copied into public/packs/<id>/ at build time. */
export const BUILTIN_PACKS: { id: string; name: string; url: string }[] = [
  { id: 'mausritter', name: 'Mausritter', url: 'packs/mausritter/' },
]

export async function loadPack(_baseUrl: string): Promise<LoadedPack> {
  throw new Error('rules: not implemented')
}
export function createRulesEngine(_pack: LoadedPack): RulesEngine {
  throw new Error('rules: not implemented')
}
