// Builds the dnd5e creature compendium (packs/dnd5e/creatures/<document>.json) from the Open5e v2
// API. Only documents on the allow list are pulled, and only when Open5e labels them
// Creative Commons Attribution 4.0: the SRD 5.2 (`srd-2024`) and the SRD 5.1 (`srd-2014`). Every
// OGL-only document (Tome of Beasts, Creature Codex, ...) is skipped, as are CC-BY documents that
// are not the SRD (Black Flag, A5e), so the pack stays SRD-only.
//
//   node scripts/build-creatures/index.mjs                 fetch and write the snapshot
//   node scripts/build-creatures/index.mjs --cache <dir>   keep raw API pages in <dir> and reuse them
//
// The output is deterministic for the same API data (sorted by name, no timestamps).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { creatureEntry } from './convert.mjs'

const API = 'https://api.open5e.com/v2'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(root, 'packs', 'dnd5e', 'creatures')

/** Allowed documents, with the attribution the SRD itself asks for. */
const DOCUMENTS = {
  'srd-2024': {
    title: 'SRD 5.2.1',
    attribution:
      'This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
    url: 'https://www.dndbeyond.com/srd',
  },
  'srd-2014': {
    title: 'SRD 5.1',
    attribution:
      'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.',
    url: 'https://dnd.wizards.com/resources/systems-reference-document',
  },
}
const CC_BY = 'cc-by-40'

const args = process.argv.slice(2)
const cacheDir = args.includes('--cache') ? path.resolve(args[args.indexOf('--cache') + 1]) : null
if (cacheDir) mkdirSync(cacheDir, { recursive: true })

async function getJson(url) {
  const file = cacheDir ? path.join(cacheDir, url.replace(/[^A-Za-z0-9]+/g, '_') + '.json') : null
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (res.ok) {
      const body = await res.json()
      if (file) writeFileSync(file, JSON.stringify(body))
      return body
    }
    if (attempt >= 4) throw new Error(`HTTP ${res.status} for ${url}`)
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

async function getAll(url) {
  const out = []
  for (let next = url; next; ) {
    const page = await getJson(next)
    out.push(...(page.results ?? []))
    next = page.next
  }
  return out
}

const documents = await getAll(`${API}/documents/?format=json&limit=100`)
mkdirSync(outDir, { recursive: true })
let total = 0
for (const [key, meta] of Object.entries(DOCUMENTS)) {
  const doc = documents.find((d) => d.key === key)
  if (!doc) throw new Error(`Open5e has no document "${key}"`)
  const licences = (doc.licenses ?? []).map((l) => l.key)
  if (!licences.includes(CC_BY)) {
    console.warn(`skip ${key}: not labelled CC-BY-4.0 (${licences.join(', ')})`)
    continue
  }
  const raw = await getAll(`${API}/creatures/?format=json&limit=100&document__key=${encodeURIComponent(key)}`)
  const creatures = raw
    .filter((c) => c.document?.key === key)
    .map((c) => creatureEntry(c, key))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
  const file = {
    document: { key, name: doc.name, title: meta.title, license: 'CC-BY-4.0', attribution: meta.attribution, url: meta.url, via: 'https://open5e.com' },
    creatures,
  }
  // One creature per line keeps diffs readable without pretty-printing every field.
  const body = `{"document":${JSON.stringify(file.document)},\n"creatures":[\n${creatures.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`
  writeFileSync(path.join(outDir, `${key}.json`), body)
  const kinds = {}
  for (const c of creatures) for (const a of c.data.actions) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1
  console.log(`${key}: ${creatures.length} creatures, ${(body.length / 1024).toFixed(0)} KiB, actions ${JSON.stringify(kinds)}`)
  total += creatures.length
}
console.log(`wrote ${total} creatures to ${path.relative(root, outDir)}`)
