import type { Config } from 'tailwindcss'
import sharedConfig from '@tapes-monorepo/tailwind-config'

const config: Pick<Config, 'content' | 'presets'> = {
  // content: ['./src/**/*.tsx'],
  content: ['../../packages/core/app/**/*.tsx'],
  presets: [sharedConfig],
}

export default config
