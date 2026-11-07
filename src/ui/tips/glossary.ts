/**
 * One glossary for every tooltip: the pack's own terms (`files.glossary`), its conditions and
 * resources, and a few table words every pack shares (burst, cone). Skill, status and term texts
 * link the first mention of each term so a tap opens it one level deeper. Pure; no React.
 */
import type { ConditionDef, GlossaryTerm, ResourceDef } from '@/core/pack'

export type GlossaryKind = 'term' | 'condition' | 'resource' | 'table'

export interface GlossaryEntry {
  /** Unique across kinds: `term:advantage`, `condition:prone`, `resource:hp`, `table:burst`. */
  id: string
  kind: GlossaryKind
  term: string
  text: string
  /** Spellings that link here (the term itself and its aliases). */
  names: string[]
}

export interface Glossary {
  entries: ReadonlyMap<string, GlossaryEntry>
  /** Lower-cased spelling to entry id. */
  byName: ReadonlyMap<string, string>
  /** Matches any spelling as a whole word; null when the glossary is empty. */
  pattern: RegExp | null
}

/** Words of the table itself, the same in every pack. */
export const TABLE_TERMS: GlossaryTerm[] = [
  { id: 'burst', term: 'burst', aliases: ['bursts'], text: 'An area aimed at a spot within range: everyone whose token stands inside the circle is caught.' },
  { id: 'cone', term: 'cone', text: 'An area that fans out from the caster in the direction aimed. The caster is never inside it.' },
]

export interface GlossarySource {
  glossary?: readonly GlossaryTerm[]
  conditions?: readonly ConditionDef[]
  resources?: readonly ResourceDef[]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildGlossary(pack: GlossarySource | null | undefined): Glossary {
  const entries = new Map<string, GlossaryEntry>()
  const byName = new Map<string, string>()
  const add = (e: GlossaryEntry) => {
    // An earlier entry keeps a spelling; a pack term with a condition's name adds its text instead of a twin.
    const clash = byName.get(e.term.toLowerCase())
    if (clash) {
      const prev = entries.get(clash)!
      if (e.kind === 'term' && prev.kind !== 'term' && e.text && !prev.text.includes(e.text)) entries.set(clash, { ...prev, text: `${prev.text} ${e.text}`.trim() })
      return
    }
    entries.set(e.id, e)
    for (const n of e.names) {
      const k = n.toLowerCase().trim()
      if (k && !byName.has(k)) byName.set(k, e.id)
    }
  }
  for (const c of pack?.conditions ?? []) add({ id: `condition:${c.id}`, kind: 'condition', term: c.name, text: c.description, names: [c.name] })
  for (const r of pack?.resources ?? []) add({ id: `resource:${r.id}`, kind: 'resource', term: r.name, text: resourceText(r), names: [r.name] })
  for (const t of pack?.glossary ?? []) add({ id: `term:${t.id}`, kind: 'term', term: t.term, text: t.text, names: [t.term, ...(t.aliases ?? [])] })
  for (const t of TABLE_TERMS) add({ id: `table:${t.id}`, kind: 'table', term: t.term, text: t.text, names: [t.term, ...(t.aliases ?? [])] })
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escape)
  const pattern = names.length ? new RegExp(`(?<![\\p{L}\\p{N}_-])(${names.join('|')})(?![\\p{L}\\p{N}_-])`, 'giu') : null
  return { entries, byName, pattern }
}

function resourceText(r: ResourceDef): string {
  const reset = r.resetOn === 'rest' ? ' Refills on a rest.' : r.resetOn === 'longRest' ? ' Refills on a long rest.' : r.resetOn === 'session' ? ' Refills each session.' : ''
  return `A pool on the character sheet that skills spend or damage takes.${reset}`
}

/** A run of text, or a mention of the glossary entry `id`. */
export type TextPart = { text: string; id?: string }

/**
 * Splits `text` into plain runs and term mentions. Each entry links once (its first mention), and
 * `skip` (the entry the text belongs to) never links to itself.
 */
export function linkTerms(text: string, glossary: Glossary, skip?: string): TextPart[] {
  if (!glossary.pattern || !text) return text ? [{ text }] : []
  const out: TextPart[] = []
  const seen = new Set<string>(skip ? [skip] : [])
  let last = 0
  const re = new RegExp(glossary.pattern.source, glossary.pattern.flags)
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = glossary.byName.get(m[0].toLowerCase())
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], id })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
