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

// GitHub Pages serves from /vttrpg/. Local dev uses /.
export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(buildId()), __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  base: command === 'build' ? '/vttrpg/' : '/',
  plugins: [
    react(),
    packsPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
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
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell and packs are precached; scenes and library blobs are cached on first use.
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
        globIgnores: ['**/library/scenes/**', '**/*.map'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: command === 'build' ? '/vttrpg/index.html' : '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/library/'),
            handler: 'CacheFirst',
            options: { cacheName: 'library', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
}))
