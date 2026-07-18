import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { peerDependencies, dependencies } from './package.json'

const external = [...Object.keys(peerDependencies), ...Object.keys(dependencies)]

export default defineConfig({
  plugins: [
    react({
      include: /\.(mdx|js|jsx|ts|tsx)$/,
    }),
    dts(),
  ],
  build: {
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'lib', 'index.ts'),
      formats: ['es'],
      name: '@tapes-monorepo/ui',
      fileName: 'ui',
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
})
