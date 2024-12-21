import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

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
  plugins: [react(), wasm(), topLevelAwait()],
})
