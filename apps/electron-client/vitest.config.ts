import path from 'path'
import { defineConfig } from 'vitest/config'

// Node-environment unit tests for the main-process modules. The `@/` alias
// mirrors tsconfig.json so imports resolve the same way under test.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
