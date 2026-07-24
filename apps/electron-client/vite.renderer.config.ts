import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// Vite's dev server injects CSS updates via inline <style> tags for HMR,
// which the production style-src 'self' CSP would block. Relax it for dev only.
function devCspAllowInlineStyles(): Plugin {
  return {
    name: 'dev-csp-allow-inline-styles',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    },
  }
}

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Enables live reloading the electron renderer
      // when changes are made in the core package.
      '@tapes-monorepo/core': path.resolve(
        __dirname,
        '../../packages/core/dist/core.js',
      ),
      // Alias the core styles import to avoid naming conflict.
      '@tapes-monorepo/core-styles': path.resolve(
        __dirname,
        '../../packages/core/dist/core.css',
      ),
    },
  },
  // The Automerge WASM glue emits top-level await and destructuring; esbuild
  // can't down-level those to Vite's default browser target, so build for the
  // modern Electron renderer (Chromium) where both are supported natively.
  build: {
    target: 'esnext',
  },
  plugins: [react(), wasm(), topLevelAwait(), devCspAllowInlineStyles()],
})
