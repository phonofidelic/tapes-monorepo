import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import preserveDirectives from 'rollup-plugin-preserve-directives'
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
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'lib', 'index.ts'),
      formats: ['es'],
      name: '@tapes-monorepo/ui',
      fileName: 'ui',
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
})
