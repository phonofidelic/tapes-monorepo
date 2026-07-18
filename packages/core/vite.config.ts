import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { peerDependencies, dependencies } from './package.json'

const external = [...Object.keys(peerDependencies), ...Object.keys(dependencies)]

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    react({
      include: /\.(mdx|js|jsx|ts|tsx)$/,
    }),
    dts(),
  ],
  build: {
    emptyOutDir: false,
    // esnext so esbuild doesn't try to downlevel the top-level-await /
    // destructuring output; the consuming apps set their own build target.
    target: 'esnext',
    lib: {
      entry: path.resolve(__dirname, 'index.ts'),
      formats: ['es'],
      name: '@tapes-monorepo/core',
      fileName: 'core',
    },
    rollupOptions: {
      // Externalize each dep and its subpaths (e.g. react/jsx-runtime,
      // emitted by @vitejs/plugin-react's automatic JSX runtime).
      external: (id) =>
        external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
      output: {
        globals: {
          react: 'React',
        },
        preserveModules: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
      '@tapes-monorepo/ui': path.resolve(__dirname, '../ui/dist/ui.js'),
      '@tapes-monorepo/ui-styles': path.resolve(__dirname, '../ui/dist/ui.css'),
    },
  },
})
