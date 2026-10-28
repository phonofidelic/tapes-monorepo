import { config } from '@tapes-monorepo/eslint-config/base'
import globals from 'globals'

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // The page is plain browser JavaScript, served as it is written.
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
]
