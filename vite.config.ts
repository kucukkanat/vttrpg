/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { cpSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

/** Serves ./packs at /packs in dev and copies it into dist/packs on build. */
function packsPlugin(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const src = path.join(root, 'packs')
  let outDir = 'dist'
  let enabled = false
  return {
    name: 'vttrpg-packs',
    configResolved(c) { outDir = c.build.outDir; enabled = c.command === 'build' && c.mode !== 'test' },
    configureServer(server) {
      server.middlewares.use('/packs', (req, res, next) => {
        const file = path.join(src, decodeURIComponent(req.url ?? '/'))
        if (!file.startsWith(src) || !existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream')
        import('node:fs').then((fs) => fs.createReadStream(file).pipe(res))
      })
    },
    closeBundle() { if (enabled && existsSync(src)) cpSync(src, path.join(root, outDir, 'packs'), { recursive: true }) },
  }
}

function buildId(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'dev' }
}

/**
 * Vendor chunks, matched against the module id in order (first match wins, so `@react-three/rapier`
 * goes with rapier). Each library is used from one side only: three and rapier from the table and
 * dice, nostr and yjs from the network layer, so no chunk is pulled in by the other side by accident.
 */
const VENDOR_CHUNKS: Array<[name: string, test: RegExp]> = [
  ['rapier', /\/node_modules\/(@dimforge\/rapier3d-compat|@react-three\/rapier)\//],
  ['three', /\/node_modules\/(three|three-stdlib|three-mesh-bvh|@react-three\/(fiber|drei)|@monogrid\/gainmap-js|camera-controls|maath|meshline|troika-three-text|stats-gl|stats\.js|detect-gpu|hls\.js|glsl-noise|its-fine|react-use-measure|suspend-react|tunnel-rat|react-reconciler|@use-gesture\/react)\//],
  // zustand is the app's store and also fiber's; it has to be assigned here (see vendorChunk).
  ['react', /\/node_modules\/(react|react-dom|scheduler|use-sync-external-store|zustand)\//],
  ['nostr', /\/node_modules\/(nostr-tools|@noble\/[^/]+|@scure\/[^/]+)\//],
  ['yjs', /\/node_modules\/(yjs|lib0)\//],
]

function vendorChunk(id: string): string | undefined {
  // Rollup folds every unassigned static dependency of a manual chunk into that chunk. Vite's
  // dynamic-import preload helper is used by drei as well as by the app's lazy routes, so without
  // a home of its own it would land in `three` and make every page load it. It rides with react,
  // which every page loads anyway.
  if (id.includes('vite/preload-helper')) return 'react'
  if (!id.includes('/node_modules/')) return undefined
  return VENDOR_CHUNKS.find(([, test]) => test.test(id))?.[0]
}

// GitHub Pages serves from /vttrpg/. Local dev uses /.
export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(buildId()), __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  base: command === 'build' ? '/vttrpg/' : '/',
  plugins: [
    react(),
    packsPlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'VTTRPG',
        short_name: 'VTTRPG',
        description: '3D virtual tabletop for any ruleset. No servers, no accounts.',
        theme_color: '#0e0e10',
        background_color: '#0e0e10',
        display: 'standalone',
        orientation: 'any',
        start_url: command === 'build' ? '/vttrpg/' : '/',
        scope: command === 'build' ? '/vttrpg/' : '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Padded copies for launchers that crop to a circle or squircle (scripts/make-icons.mjs).
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell (entry, route and vendor chunks) and packs are precached; scenes and library
        // blobs are cached on first use. The `three` vendor chunk is the largest file (about 1 MB
        // minified), then the draco decoder (720 kB) and basis transcoder (530 kB): keep the limit above.
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
        // Creature compendiums (about 1.4 MB for dnd5e) are only opened by the GM: cached on first use.
        globIgnores: ['**/library/scenes/**', '**/*.map', '**/packs/*/creatures/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: command === 'build' ? '/vttrpg/index.html' : '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/library/'),
            handler: 'CacheFirst',
            // The curated library alone is about 300 models plus a thumbnail each.
            options: { cacheName: 'library', expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/packs/') && url.pathname.includes('/creatures/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'creatures', expiration: { maxEntries: 20 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The entry chunk stays small (scripts/check-bundle.mjs enforces 600 kB): the game route, the
    // table, the dice tray and the GM-only panels are `React.lazy`, and the heavy libraries are
    // grouped so each is fetched once, by the route that first needs it.
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
  server: { port: 5173 },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
}))
