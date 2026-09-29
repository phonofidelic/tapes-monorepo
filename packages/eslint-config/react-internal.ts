import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import turboPlugin from 'eslint-plugin-turbo'
import tseslint from 'typescript-eslint'

export const config = defineConfig({
  extends: [
    js.configs.recommended,
    eslintConfigPrettier,
    tseslint.configs.recommended,
    {
      plugins: {
        turbo: turboPlugin,
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
