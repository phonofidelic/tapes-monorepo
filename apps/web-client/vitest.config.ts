import path from 'path'
import { defineConfig } from 'vitest/config'

// Node-environment unit tests for the browser-independent modules. The `@/`
// alias mirrors vite.config.ts so imports resolve the same way under test.
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
