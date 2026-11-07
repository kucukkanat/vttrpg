import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const LIBRARY = path.join(REPO, 'public', 'library')
/** Where the downloaded source packs live; not committed. */
export const SRC_ROOT = process.env.LIBRARY_SRC ? path.resolve(process.env.LIBRARY_SRC) : path.join(REPO, '.cache', 'library-src')

/** Library-relative output path of a pick, without extension. Kit pieces live under kits/. */
export function outBase(pick) {
  return pick.kit ? `kits/${pick.kit}/${pick.slug}` : `models/${pick.pack}/${pick.slug}`
}
