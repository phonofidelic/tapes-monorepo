import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import preserveDirectives from 'rollup-plugin-preserve-directives'
import dts from 'vite-plugin-dts'
import { peerDependencies, dependencies } from './package.json'

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'classic',
      include: /\.(mdx|js|jsx|ts|tsx)$/,
    }),
    dts(),
  ],
  esbuild: {
    jsxFactory: '_jsx',
    jsxFragment: '_jsxFragment',
    jsxInject: `import { createElement as _jsx, Fragment as _jsxFragment } from 'react'`,
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'index.ts'),
      formats: ['es'],
      name: '@tapes-monorepo/core',
      fileName: 'core',
    },
    rollupOptions: {
      external: [
        ...Object.keys(peerDependencies),
        ...Object.keys(dependencies),
      ],
      output: {
        globals: {
          react: 'React',
        },
        preserveModules: true,
      },
      plugins: [preserveDirectives],
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
