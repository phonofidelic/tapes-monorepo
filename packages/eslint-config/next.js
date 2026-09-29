import { defineConfig } from 'eslint/config'
import eslintReact from '@eslint-react/eslint-plugin'
import pluginNext from '@next/eslint-plugin-next'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import { config } from './base.js'
import globals from 'globals'

export const nextJsConfig = defineConfig({
  extends: [
    ...config,
    {
      ...eslintReact.configs.recommended,
      languageOptions: {
        ...eslintReact.configs.recommended.languageOptions,
        globals: { ...globals.serviceworker },
      },
    },
    pluginReactHooks.configs.flat.recommended,
    {
      plugins: {
        '@next/next': pluginNext,
      },
      rules: {
        ...pluginNext.configs.recommended.rules,
        ...pluginNext.configs['core-web-vitals'].rules,
      },
    },
  ],
})
