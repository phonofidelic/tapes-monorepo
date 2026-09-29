import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import ts from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import turbo from 'eslint-plugin-turbo'

export const config = defineConfig({
  extends: [
    js.configs.recommended,
    eslintConfigPrettier,
    ...ts.configs.recommended,
    {
      plugins: {
        turbo,
      },
      rules: {
        'turbo/no-undeclared-env-vars': 'warn',
      },
    },
    {
      // Build output and CommonJS config shims (postcss.config.cjs, etc.) are
      // not application source and should not be linted.
      ignores: ['dist/**', '**/*.cjs'],
    },
  ],
})
