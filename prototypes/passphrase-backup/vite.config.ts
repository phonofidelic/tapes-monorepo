import path from 'path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// THROWAWAY prototype for TAP-218. HTTPS is on so a phone on the LAN gets a
// secure context, which the camera and WebCrypto Ed25519 both need. The
// provenance package is read from source so no build step is needed first.
export default defineConfig({
  plugins: [basicSsl()],
  resolve: {
    alias: {
      '@tapes-monorepo/provenance': path.resolve(
        import.meta.dirname,
        '../../packages/provenance/lib/index.ts',
      ),
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'index.html'),
        restore: path.resolve(import.meta.dirname, 'restore.html'),
        bench: path.resolve(import.meta.dirname, 'bench.html'),
      },
    },
  },
  worker: { format: 'es' },
})
