/**
 * Bundle budget for the production build. Fails when the entry chunk (the JS every page loads)
 * is over the limit, or when it statically depends on a table-only vendor chunk (three, rapier),
 * which would mean the home / new / join pages ship the 3D stack again.
 *
 * Usage: `npm run build:check` (or `node scripts/check-bundle.mjs` after `vite build`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ENTRY_LIMIT_BYTES = 600 * 1000
const TABLE_ONLY_CHUNKS = /^(three|rapier)-/

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')
const assets = path.join(dist, 'assets')

const kB = (n) => `${(n / 1000).toFixed(1).padStart(9)} kB`

function entryChunk() {
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8')
  const m = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)
  if (!m) throw new Error('dist/index.html has no module script tag')
  return path.basename(m[1])
}

/** Chunks a chunk imports statically (`import ... from "./x.js"`, `import "./x.js"`), not `import("./x.js")`. */
function staticImports(file) {
  const code = readFileSync(path.join(assets, file), 'utf8')
  const out = new Set()
  for (const m of code.matchAll(/(?:\bimport|\bfrom)\s*["']\.\/([^"']+\.js)["']/g)) out.add(m[1])
  return [...out]
}

/** The entry plus everything it loads before the first render. */
function startupClosure(entry) {
  const seen = new Set([entry])
  const queue = [entry]
  while (queue.length) {
    for (const dep of staticImports(queue.shift())) {
      if (!seen.has(dep)) { seen.add(dep); queue.push(dep) }
    }
  }
  return [...seen]
}

const entry = entryChunk()
const chunks = readdirSync(assets).filter((f) => f.endsWith('.js'))
  .map((f) => { const buf = readFileSync(path.join(assets, f)); return { file: f, size: buf.length, gzip: gzipSync(buf).length } })
  .sort((a, b) => b.size - a.size)
const startup = startupClosure(entry)

console.log('chunk'.padEnd(44) + ' minified     gzip')
for (const c of chunks) console.log(`${c.file.padEnd(44)}${kB(c.size)}${kB(c.gzip)}${startup.includes(c.file) ? '  (startup)' : ''}`)
const entrySize = statSync(path.join(assets, entry)).size
const startupBytes = startup.reduce((n, f) => n + statSync(path.join(assets, f)).size, 0)
console.log(`\nentry ${entry}: ${kB(entrySize).trim()} (limit ${kB(ENTRY_LIMIT_BYTES).trim()})`)
console.log(`startup JS (entry + static imports): ${startup.length} chunks, ${kB(startupBytes).trim()}`)

const failures = []
if (entrySize > ENTRY_LIMIT_BYTES) failures.push(`entry chunk ${entry} is ${kB(entrySize).trim()}, over the ${kB(ENTRY_LIMIT_BYTES).trim()} limit`)
for (const f of startup) if (TABLE_ONLY_CHUNKS.test(f)) failures.push(`${f} is loaded at startup; it should only load with the game route`)

if (failures.length) {
  console.error('\nBundle check failed:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nBundle check passed.')
