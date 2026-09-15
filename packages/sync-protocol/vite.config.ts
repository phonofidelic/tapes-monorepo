import path from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Plain TypeScript with no dependencies, so there is nothing to externalize and
// no framework plugin. The Electron main process imports this package as well
// as renderer code does, which is the reason it exists.
export default defineConfig({
  plugins: [dts()],
  build: {
    emptyOutDir: false,
    sourcemap: true,
    target: 'esnext',
    lib: {
      entry: path.resolve(__dirname, 'lib', 'index.ts'),
      formats: ['es'],
      name: '@tapes-monorepo/sync-protocol',
      fileName: 'sync-protocol',
    },
  },
})
