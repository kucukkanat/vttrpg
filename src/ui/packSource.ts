/**
 * Third-party system packs: by URL (a folder with `pack.json`, served with CORS) or as a single
 * bundle file. A bundle is JSON `{ "format": "vttrpg-pack", "files": { "pack.json": {...},
 * "attributes.json": [...], ... } }` keyed by the paths `pack.json` lists. A bundle is stored as
 * a content-addressed asset (`meta.packAsset`) so every client can fetch the same bytes; a URL
 * is stored in `meta.packSource`. Both go through the pack loader's validation, and errors are
 * phrased for the person picking the pack. Packs are data only: no scripts run from them.
 */
import { BUILTIN_PACKS, createRulesEngine, loadPack, type FetchLike, type LoadedPack, type RulesEngine } from '@/rules'
import type { AssetRef } from '@/core/assets'
import type { GameMeta } from '@/core/doc'
import type { AssetResolver } from '@/assets'

export const PACK_BUNDLE_FORMAT = 'vttrpg-pack'
/** Bundles bigger than this are refused before parsing. */
export const MAX_PACK_BUNDLE_BYTES = 4 * 1024 * 1024

export class PackSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackSourceError'
  }
}

/** `https://host/packs/x/pack.json` or `.../x` -> `https://host/packs/x/`. Throws for anything that is not http(s). */
export function normalizePackUrl(input: string): string {
  const raw = input.trim()
  if (!raw) throw new PackSourceError('Paste the address of the pack folder (or of its pack.json).')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PackSourceError('That is not a web address. It should start with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PackSourceError('Packs load over https:// only.')
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/pack\.json$/i, '/')
  if (!path.endsWith('/')) path += '/'
  url.pathname = path
  return url.toString()
}

/** Turns loader failures into one sentence the GM can act on. */
export function explainPackError(e: unknown, where: string): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(msg))
    return `Could not reach ${where}. Check the address; the server must allow cross-origin requests (CORS).`
  if (/HTTP 404/.test(msg)) return `${msg.replace(/^pack: /, '')}. Is this the folder that holds pack.json?`
  return `The pack is not valid: ${msg.replace(/^pack: /, '')}`
}

/** Serves files out of a parsed bundle to the pack loader. */
export function bundleFetcher(files: Record<string, unknown>): FetchLike {
  return async (url) => {
    const key = url.replace(/^bundle:\/*/, '').replace(/^\.\//, '')
    if (!(key in files)) return { ok: false, status: 404, json: async () => null }
    return { ok: true, status: 200, json: async () => files[key] }
  }
}

export interface PackBundle { files: Record<string, unknown> }

export function parsePackBundle(text: string): PackBundle {
  if (text.length > MAX_PACK_BUNDLE_BYTES) throw new PackSourceError(`The pack file is larger than ${MAX_PACK_BUNDLE_BYTES / 1024 / 1024} MB.`)
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new PackSourceError('The pack file is not JSON.')
  }
  const rec = v as { format?: unknown; files?: unknown }
  if (!rec || typeof rec !== 'object' || rec.format !== PACK_BUNDLE_FORMAT)
    throw new PackSourceError(`Not a pack bundle: expected "format": "${PACK_BUNDLE_FORMAT}".`)
  if (!rec.files || typeof rec.files !== 'object' || Array.isArray(rec.files)) throw new PackSourceError('The pack bundle has no "files" object.')
  if (!('pack.json' in (rec.files as object))) throw new PackSourceError('The pack bundle has no "pack.json" entry.')
  return { files: rec.files as Record<string, unknown> }
}

export async function loadPackFromBundle(bundle: PackBundle): Promise<LoadedPack> {
  try {
    return await loadPack('bundle:/', bundleFetcher(bundle.files))
  } catch (e) {
    throw new PackSourceError(explainPackError(e, 'the pack file'))
  }
}

export async function loadPackFromUrl(input: string, fetchImpl?: FetchLike): Promise<{ url: string; pack: LoadedPack }> {
  const url = normalizePackUrl(input)
  try {
    return { url, pack: await loadPack(url, fetchImpl) }
  } catch (e) {
    throw new PackSourceError(explainPackError(e, new URL(url).host))
  }
}

/** What a game names as its system: a built-in id, a pack URL or a bundle asset. */
export interface PackChoice {
  id: string
  source?: string
  asset?: AssetRef
}

export const packChoiceOf = (meta: Partial<GameMeta> | undefined, fallback: string): PackChoice => ({
  id: (meta?.pack as string | undefined) ?? fallback,
  source: meta?.packSource,
  asset: meta?.packAsset,
})

/** Loads the rules for a game's pack choice; built-ins come from this site. */
export async function loadPackChoice(choice: PackChoice, assets: AssetResolver, base: string): Promise<LoadedPack> {
  if (choice.asset) {
    const url = await assets.resolve(choice.asset)
    const res = await fetch(url)
    return loadPackFromBundle(parsePackBundle(await res.text()))
  }
  if (choice.source) return (await loadPackFromUrl(choice.source)).pack
  const builtin = BUILTIN_PACKS.find((p) => p.id === choice.id)?.url ?? `packs/${choice.id}/`
  return loadPack(base + builtin)
}

export async function rulesForChoice(choice: PackChoice, assets: AssetResolver, base: string): Promise<{ rules: RulesEngine | null; error?: string }> {
  try {
    return { rules: createRulesEngine(await loadPackChoice(choice, assets, base)) }
  } catch (e) {
    console.warn('rules engine unavailable:', e)
    return { rules: null, error: e instanceof Error ? e.message : String(e) }
  }
}
