import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tapes-monorepo/ui': path.resolve(__dirname, '../../packages/ui/lib'),
      '@tapes-monorepo/ui-styles': path.resolve(
        __dirname,
        '../../packages/ui/dist/ui.css',
      ),
      '@tapes-monorepo/core': path.resolve(
        __dirname,
        '../../packages/core/app',
      ),
    },
  },
  plugins: [react()],
})
