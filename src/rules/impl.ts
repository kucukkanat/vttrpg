/** Entry points re-exported by `src/rules/index.ts`. */
export { loadPack } from './load'
export { createRulesEngine } from './engine'

/** Built-in packs are served from `packs/<id>/` in dev and copied into dist on build. */
export const BUILTIN_PACKS: { id: string; name: string; url: string }[] = [
  { id: 'mausritter', name: 'Mausritter', url: 'packs/mausritter/' },
  { id: 'dnd5e', name: 'D&D 5e (SRD)', url: 'packs/dnd5e/' },
]
