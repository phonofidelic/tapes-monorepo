import path from 'path'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const plugins = [wasm(), topLevelAwait(), react()]

if (process.env.HTTPS === 'true') {
  plugins.push(basicSsl())
}
// https://vitejs.dev/config/
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
  plugins,
  server: {
    // When a LAN guest is served the app from this dev server (for HMR), its
    // Automerge sync socket connects to `/sync` on the same origin. Proxy that
    // to the Electron host's embedded sync server, which runs on loopback of
    // this same machine (DEFAULT_SYNC_SERVER_PORT = 9001). `secure: false` lets
    // a `wss://` guest (dev:https) tunnel to the plain `ws://` loopback target.
    proxy: {
      '/sync': {
        target: 'ws://127.0.0.1:9001',
        ws: true,
        secure: false,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
})
