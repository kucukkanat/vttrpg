#!/usr/bin/env node
/**
 * Regenerates every generated scene in public/library/scenes (the three starter scenes plus the
 * dev room). Run `npm run library:index` afterwards so index.json picks up the new hashes.
 *
 *   npm run scenes
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const scripts = [
  resolve(here, 'tavern.mjs'),
  resolve(here, 'dungeon.mjs'),
  resolve(here, 'forest.mjs'),
  resolve(here, '../make-dev-room.mjs'),
]
for (const s of scripts) execFileSync(process.execPath, [s], { stdio: 'inherit' })
