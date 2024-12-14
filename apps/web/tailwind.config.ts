import type { Config } from 'tailwindcss'
import sharedConfig from '@tapes-monorepo/tailwind-config'

const config: Pick<Config, 'content' | 'presets' | 'theme'> = {
  content: ['./app/**/*.tsx', '../../packages/core/app/**/*.tsx'],
  presets: [sharedConfig],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
} satisfies Config

export default config
