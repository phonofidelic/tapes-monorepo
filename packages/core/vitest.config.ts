import path from 'path'
import { defineConfig, type ViteUserConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// A dedicated config, kept separate from vite.config.ts (a lib-build config).
// The `plugins` cast bridges a two-copies-of-vite type mismatch: vitest depends
// on vite 7, while the workspace uses rolldown-based vite 8, so @vitejs/plugin-react
// produces a vite-8 Plugin that isn't structurally assignable to vitest's vite-7
// PluginOption. It runs fine — this only satisfies the type checker. The aliases
// mirror vite.config.ts so `@/` and the built `@tapes-monorepo/ui` resolve the
// same way under test.
export default defineConfig({
  plugins: [react()] as unknown as ViteUserConfig['plugins'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
      '@tapes-monorepo/ui': path.resolve(__dirname, '../ui/dist/ui.js'),
      '@tapes-monorepo/ui-styles': path.resolve(__dirname, '../ui/dist/ui.css'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
