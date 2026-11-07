/**
 * Renders a 256 px square WebP thumbnail next to every library model (models/, kits/, props/)
 * with three.js in headless Chrome (thumb.html). Existing thumbnails newer than their model are
 * kept unless `--force` is passed.
 *
 * Needs playwright-core and a Chrome or Chromium binary:
 *   PLAYWRIGHT_CORE  path to the playwright-core package (default: resolve `playwright-core`)
 *   CHROME_PATH      browser executable (default: Playwright's cached Chromium on macOS)
 */
import { createServer } from 'node:http'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LIBRARY, REPO } from './paths.mjs'

export const THUMB_SIZE = 256
const FOLDERS = ['models', 'kits', 'props']

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' }

function serve() {
  const server = createServer((req, res) => {
    const file = path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(REPO) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

async function playwright() {
  const spec = process.env.PLAYWRIGHT_CORE
  if (spec) return import(pathToFileURL(path.join(spec, 'index.mjs')).href)
  return import('playwright-core')
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright')
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []
  for (const d of dirs) {
    const p = path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  return undefined
}

function* models() {
  for (const top of FOLDERS) {
    const dir = path.join(LIBRARY, top)
    if (!existsSync(dir)) continue
    const walk = function* (d) {
      for (const n of readdirSync(d).sort()) {
        const f = path.join(d, n)
        if (statSync(f).isDirectory()) yield* walk(f)
        else if (n.endsWith('.glb')) yield f
      }
    }
    yield* walk(dir)
  }
}

export async function renderThumbs({ force = false, filter } = {}) {
  const todo = [...models()].filter((f) => {
    if (filter && !f.includes(filter)) return false
    const thumb = f.replace(/\.glb$/, '.webp')
    return force || !existsSync(thumb) || statSync(thumb).mtimeMs < statSync(f).mtimeMs
  })
  if (!todo.length) { console.log('thumbnails up to date'); return }
  const server = await serve()
  const { chromium } = await playwright()
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } })
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/scripts/make-library/thumb.html`)
    await page.waitForFunction(() => window.ready === true)
    for (const f of todo) {
      const url = '/' + path.relative(REPO, f).split(path.sep).join('/')
      const data = await page.evaluate(([u, s]) => window.renderThumb(u, s), [url, THUMB_SIZE])
      const bytes = Buffer.from(data.split(',')[1], 'base64')
      writeFileSync(f.replace(/\.glb$/, '.webp'), bytes)
    }
    console.log(`rendered ${todo.length} thumbnails`)
  } finally {
    await browser.close()
    server.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  await renderThumbs({ force: args.includes('--force'), filter: args.find((a) => !a.startsWith('--')) })
}
