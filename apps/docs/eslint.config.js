import { nextJsConfig } from '@tapes-monorepo/eslint-config/next-js'

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  {
    ignores: ['.next/**', 'out/**', 'next-env.d.ts'],
  },
]
