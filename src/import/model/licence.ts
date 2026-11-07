/**
 * The licence gate: only licences that allow re-hosting on public Blossom servers may be imported
 * (CC0, CC BY, CC BY-SA, own work), and the ones that need credit must name the author.
 * Also the mapping from provider licence ids to ours, and the attribution block embedded in the GLB.
 */
import { isShareable, LICENCE_LABELS, needsCredit, type Licence, type LicenceId } from '@/core/catalogue'
import { ModelImportError } from './types'

/** Sketchfab licence slugs (`GET /v3/licenses`) and what they map to here; null = not importable. */
export const SKETCHFAB_LICENCE_SLUGS: Record<string, LicenceId | null> = {
  cc0: 'cc0',
  by: 'cc-by',
  'by-sa': 'cc-by-sa',
  'by-nd': null,
  'by-nc': null,
  'by-nc-sa': null,
  'by-nc-nd': null,
  'free-st': null,
  st: null,
  ed: null,
}

/**
 * Search results carry the licence as `{ uid, label }` without the slug, so match the uid first
 * (stable ids from `GET /v3/licenses`) and fall back to the label.
 */
const SKETCHFAB_LICENCE_UIDS: Record<string, string> = {
  '7c23a1ba438d4306920229c12afcb5f9': 'cc0',
  '322a749bcfa841b29dff1e8a1bb74b0b': 'by',
  b9ddc40b93e34cdca1fc152f39b9f375: 'by-sa',
  '72360ff1740d419791934298b8b6d270': 'by-nd',
  bbfe3f7dbcdd4122b966b85b9786a989: 'by-nc',
  '2628dbe5140a4e9592126c8df566c0b7': 'by-nc-sa',
  '34b725081a6a4184957efaec2cb84ed3': 'by-nc-nd',
  '72eb2b1960364637901eacce19283624': 'free-st',
  '783b685da9bf457d81e829fa283f3567': 'st',
  '5b54cf13b1a4422ca439696eb152070d': 'ed',
}

const SKETCHFAB_LICENCE_LABELS: Record<string, string> = {
  'cc0 public domain': 'cc0',
  'cc attribution': 'by',
  'cc attribution-sharealike': 'by-sa',
  'cc attribution-noderivs': 'by-nd',
  'cc attribution-noncommercial': 'by-nc',
  'cc attribution-noncommercial-sharealike': 'by-nc-sa',
  'cc attribution-noncommercial-noderivs': 'by-nc-nd',
  'free standard': 'free-st',
  standard: 'st',
  editorial: 'ed',
}

/** The Sketchfab slug for a licence object from the API (`{ uid?, slug?, label? }`), or undefined. */
export function sketchfabSlug(l: { uid?: string; slug?: string; label?: string; uri?: string } | null | undefined): string | undefined {
  if (!l) return undefined
  if (l.slug) return l.slug
  const uid = l.uid ?? l.uri?.split('/').filter(Boolean).pop()
  if (uid && SKETCHFAB_LICENCE_UIDS[uid]) return SKETCHFAB_LICENCE_UIDS[uid]
  if (l.label) return SKETCHFAB_LICENCE_LABELS[l.label.trim().toLowerCase()]
  return undefined
}

/** Our licence id for a Sketchfab licence, or null when it may not be imported. */
export function mapSketchfabLicence(l: Parameters<typeof sketchfabSlug>[0]): LicenceId | null {
  const slug = sketchfabSlug(l)
  return slug ? SKETCHFAB_LICENCE_SLUGS[slug] ?? null : null
}

/** SPDX ids, for the GLB attribution and any future Nostr asset event. */
export const LICENCE_SPDX: Record<LicenceId, string> = {
  cc0: 'CC0-1.0',
  'cc-by': 'CC-BY-4.0',
  'cc-by-sa': 'CC-BY-SA-4.0',
  'own-work': 'LicenseRef-own-work',
}

export const LICENCE_URLS: Partial<Record<LicenceId, string>> = {
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc-by': 'https://creativecommons.org/licenses/by/4.0/',
  'cc-by-sa': 'https://creativecommons.org/licenses/by-sa/4.0/',
}

/**
 * Throws a ModelImportError unless the licence may be imported. Returns a cleaned copy (trimmed
 * strings, empty fields dropped).
 */
export function validateLicence(input: { id: string; author?: string; authorUrl?: string; source?: string; sourceUrl?: string }): Licence {
  if (!input || !isShareable(input.id)) {
    throw new ModelImportError(
      'licence',
      'This licence does not allow sharing the model with your players. Only CC0, CC BY, CC BY-SA or your own work can be imported.',
    )
  }
  const clean = (s?: string) => (typeof s === 'string' && s.trim() ? s.trim() : undefined)
  const licence: Licence = { id: input.id }
  const author = clean(input.author)
  if (author) licence.author = author
  const authorUrl = cleanUrl(input.authorUrl)
  if (authorUrl) licence.authorUrl = authorUrl
  const source = clean(input.source)
  if (source) licence.source = source
  const sourceUrl = cleanUrl(input.sourceUrl)
  if (sourceUrl) licence.sourceUrl = sourceUrl
  if (needsCredit(licence) && !licence.author) {
    throw new ModelImportError('licence', `${LICENCE_LABELS[licence.id]} needs the author's name so players can see who made it.`)
  }
  return licence
}

function cleanUrl(s?: string): string | undefined {
  if (typeof s !== 'string' || !s.trim()) return undefined
  try {
    const u = new URL(s.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

/** One-line TASL credit: `"Title" by Author, CC BY 4.0, via Sketchfab, optimised and converted`. */
export function creditLine(title: string, l: Licence, modified = true): string {
  const parts = [`"${title}"`]
  if (l.author) parts[0] += ` by ${l.author}`
  parts.push(LICENCE_LABELS[l.id])
  if (l.source) parts.push(`via ${l.source}`)
  if (modified && l.id !== 'own-work') parts.push('optimised and converted')
  return parts.join(', ')
}

/** The `asset.extras` block embedded in every imported GLB, so the credit travels with the bytes. */
export interface GlbAttribution {
  licence: Licence
  attribution: {
    title: string
    author?: string
    authorUrl?: string
    source?: string
    sourceUrl?: string
    spdx: string
    licenceUrl?: string
    retrieved: string
    modifications: string
  }
}

export function attributionExtras(title: string, l: Licence, retrieved = new Date()): GlbAttribution {
  return {
    licence: { ...l },
    attribution: {
      title,
      author: l.author,
      authorUrl: l.authorUrl,
      source: l.source,
      sourceUrl: l.sourceUrl,
      spdx: LICENCE_SPDX[l.id],
      licenceUrl: LICENCE_URLS[l.id],
      retrieved: retrieved.toISOString().slice(0, 10),
      modifications: 'Converted to GLB, simplified, textures resized, re-centred and scaled to metres',
    },
  }
}
