import type { Config } from 'tailwindcss'
import sharedConfig from '@tapes-monorepo/tailwind-config'

export default {
  content: ['./app/**/*.{js,jsx,ts,tsx,mdx}'],
  presets: [sharedConfig],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
