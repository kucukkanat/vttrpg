/**
 * Downloads the CC0 source packs into the source cache (default `.cache/library-src`, override
 * with LIBRARY_SRC). Packs already present are skipped. KayKit packs come from their official
 * GitHub repositories; Kenney packs through kenney.nl's own download link, the same request its
 * Download button makes. Archives are unpacked with the system `unzip`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKS } from './packs.mjs'
import { SRC_ROOT } from './paths.mjs'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

/** Kenney serves a short-lived signed link from /download-link/<id>, where id is on the asset page. */
async function kenneyZipUrl(page) {
  const res = await get(page)
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const html = await res.text()
  const id = html.match(/data-download-id='([0-9a-f]+)'/)?.[1]
  if (!id) throw new Error(`${page}: no download id`)
  const link = await get(`https://kenney.nl/download-link/${id}`, { headers: { Referer: page, Cookie: cookie } })
  const { url } = await link.json()
  if (!url) throw new Error(`${page}: no download url`)
  return url
}

export async function fetchPacks() {
  mkdirSync(SRC_ROOT, { recursive: true })
  for (const [id, pack] of Object.entries(PACKS)) {
    const folder = pack.dir.split('/')[0]
    const dest = path.join(SRC_ROOT, folder)
    if (existsSync(path.join(SRC_ROOT, pack.dir))) continue
    const url = pack.download.includes('kenney.nl') ? await kenneyZipUrl(pack.download) : pack.download
    const zip = path.join(SRC_ROOT, `${folder}.zip`)
    writeFileSync(zip, Buffer.from(await (await get(url)).arrayBuffer()))
    mkdirSync(dest, { recursive: true })
    execFileSync('unzip', ['-q', '-o', zip, '-d', dest])
    console.log(`fetched ${id}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await fetchPacks()
