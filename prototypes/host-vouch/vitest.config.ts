// THROWAWAY PROTOTYPE (TAP-219). Reads the provenance package from source.
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@tapes-monorepo/provenance': path.resolve(
        __dirname,
        '../../packages/provenance/lib/index.ts',
      ),
    },
  },
  test: { include: ['lib/**/*.test.ts'] },
})
