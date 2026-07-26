import {
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'

// Generates the PWA icon set from `public/icon.svg`. Run it by hand with
// `yarn workspace web-client generate-pwa-assets`; the PNGs it writes are
// committed, so `sharp` never has to run on the build/CI path. Regenerate when
// icon.svg changes.
export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset: minimal2023Preset,
  images: ['public/icon.svg'],
})
