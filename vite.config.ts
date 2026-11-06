import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// GitHub Pages serves from /vttrpg/. Local dev uses /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/vttrpg/' : '/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
}))
