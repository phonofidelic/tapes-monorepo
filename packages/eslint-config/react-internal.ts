import { defineConfig } from 'eslint/config'
import eslintReact from '@eslint-react/eslint-plugin'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { config as baseConfig } from './base.ts'
import globals from 'globals'

export const config = defineConfig({
  extends: [
    ...baseConfig,
    {
      ...eslintReact.configs.recommended,
      languageOptions: {
        ...eslintReact.configs.recommended.languageOptions,
        globals: {
          ...globals.serviceworker,
          ...globals.browser,
        },
      },
    },
    tseslint.configs.recommended,
    pluginReactHooks.configs.flat.recommended,
  ],
})
