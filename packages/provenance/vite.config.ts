import path from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Plain TypeScript with no dependencies, so there is nothing to externalize and
// no framework plugin. Guests and the Electron main process both import it.
export default defineConfig({
  plugins: [dts()],
  build: {
    emptyOutDir: false,
    sourcemap: true,
    target: 'esnext',
    lib: {
      entry: path.resolve(__dirname, 'lib', 'index.ts'),
      formats: ['es'],
      name: '@tapes-monorepo/provenance',
      fileName: 'provenance',
    },
  },
})
