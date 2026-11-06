/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'

/** Serves ./packs at /packs in dev and copies it into dist/packs on build. */
function packsPlugin(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const src = path.join(root, 'packs')
  let outDir = 'dist'
  return {
    name: 'vttrpg-packs',
    configResolved(c) { outDir = c.build.outDir },
    configureServer(server) {
      server.middlewares.use('/packs', (req, res, next) => {
        const file = path.join(src, decodeURIComponent(req.url ?? '/'))
        if (!file.startsWith(src) || !existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream')
        import('node:fs').then((fs) => fs.createReadStream(file).pipe(res))
      })
    },
    closeBundle() { if (existsSync(src)) cpSync(src, path.join(root, outDir, 'packs'), { recursive: true }) },
  }
}

// GitHub Pages serves from /vttrpg/. Local dev uses /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/vttrpg/' : '/',
  plugins: [react(), packsPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
}))
