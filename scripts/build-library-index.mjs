// Regenerates public/library/index.json by hashing every file under public/library/.
// Skips index.json, *.md, license.txt and dotfiles. License per entry: first line of a
// `license.txt` in the same folder or the nearest parent folder, default CC0-1.0.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'library')

const TYPES = {
  glb: ['glb', 'model/gltf-binary'],
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  webp: ['image', 'image/webp'],
  ktx2: ['image', 'image/ktx2'],
  gif: ['image', 'image/gif'],
  mp3: ['audio', 'audio/mpeg'],
  ogg: ['audio', 'audio/ogg'],
  wav: ['audio', 'audio/wav'],
  m4a: ['audio', 'audio/mp4'],
  json: ['json', 'application/json'],
}

function licenseFor(dir) {
  for (let d = dir; d.startsWith(root); d = path.dirname(d)) {
    const f = path.join(d, 'license.txt')
    if (existsSync(f)) return readFileSync(f, 'utf8').split('\n')[0].trim() || 'CC0-1.0'
    if (d === root) break
  }
  return 'CC0-1.0'
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

const entries = []
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const base = path.basename(file)
  if (rel === 'index.json' || base.endsWith('.md') || base === 'license.txt') continue
  const bytes = readFileSync(file)
  const ext = base.split('.').pop().toLowerCase()
  const [kind, mime] = TYPES[ext] ?? ['other', 'application/octet-stream']
  entries.push({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    path: rel,
    kind,
    mime,
    size: bytes.length,
    name: base,
    license: licenseFor(path.dirname(file)),
  })
}

writeFileSync(path.join(root, 'index.json'), JSON.stringify(entries, null, 2) + '\n')
console.log(`library index: ${entries.length} entries`)
