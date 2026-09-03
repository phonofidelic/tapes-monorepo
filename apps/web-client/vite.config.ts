import path from 'path'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// This bundle is also staged into electron-client and served to LAN guests
// (`stage-web-client` sets this). Those guests get no service worker at all —
// see the `disable` option below and the unregister in src/main.tsx.
const servedByHost = process.env.VITE_SERVED_BY_HOST === 'true'

// Loopback port the `/sync` and `/blobs` proxies below hop to. The Electron
// host's embedded server owns 9001 (DEFAULT_SYNC_SERVER_PORT), which is what a
// developer running `yarn dev` alongside the desktop app wants. The two-device
// e2e harness runs its own headless host on a different port and points this
// dev server at it, so it never collides with a desktop app already running.
const syncServerPort = process.env.TAPES_SYNC_SERVER_PORT ?? '9001'

const plugins = [
  wasm(),
  topLevelAwait(),
  react(),
  VitePWA({
    // A host-served build emits no sw.js, no manifest and no injected head
    // tags. The LAN guest exists to sync with a live host, so caching it for
    // offline use buys nothing; plain-HTTP LAN mode is not a secure context so
    // a worker could not register there anyway; and the HTTPS LAN mode runs on
    // a self-signed cert (electron-client/src/certManager.ts) where a wedged
    // service worker is genuinely hard for a guest to clear.
    disable: servedByHost,
    // Never swap the bundle out from under a recording in progress. The user
    // is told an update is ready and chooses when to take it (PwaUpdatePrompt).
    registerType: 'prompt',
    // Registration happens explicitly in PwaUpdatePrompt, not via an injected
    // script, so it stays on one code path with the update UI.
    injectRegister: null,
    includeAssets: [
      'favicon-16.png',
      'favicon-32.png',
      'apple-touch-icon-180x180.png',
      'icon.svg',
      'tapes-mobile-ui.webp',
    ],
    manifest: {
      name: 'Tapes',
      short_name: 'Tapes',
      description: 'Local-first audio recording',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#ffffff',
      theme_color: '#18181b',
      icons: [
        {
          src: 'pwa-64x64.png',
          sizes: '64x64',
          type: 'image/png',
        },
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        {
          src: 'maskable-icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
      screenshots: [
        {
            src: 'tapes-mobile-ui.webp',
            sizes: '1002x1772',
            type: 'image/webp'
        }
    ]
    },
    workbox: {
      // Both of these are load-bearing for offline boot. Automerge's wasm is a
      // ~3.2 MB hashed asset that the bundle fetches at module-init time under
      // a top-level await, and Workbox would otherwise drop it *silently*:
      // `wasm` is absent from the default glob set, and the default 2 MiB size
      // cap would exclude it even once globbed. The result would be a cached
      // shell that never mounts offline. scripts/verifyPrecache.mjs fails the
      // build if the wasm ever falls out of the generated manifest again.
      globPatterns: ['**/*.{js,css,html,wasm,ico,png,svg,webmanifest}'],
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      navigateFallback: 'index.html',
      // Belt and braces. The Automerge socket connects to `/sync` on this
      // origin; WebSocket upgrades are not `fetch` events so a worker never
      // sees them, but this guarantees the shell is never served in its place.
      // `/blobs` is here for the same reason: those are `fetch` requests
      // rather than navigations, so the fallback should not apply anyway, but
      // serving the app shell in place of audio bytes fails as an opaque
      // decode error and is worth ruling out explicitly.
      navigateFallbackDenylist: [/^\/sync/, /^\/blobs/],
      cleanupOutdatedCaches: true,
    },
    // Deliberately off. A worker on the dev server would fight the LAN-guest
    // HMR flow (TAP-60) and the Playwright suite, which runs against `vite`
    // dev by design — see the webServer comment in playwright.config.ts.
    devOptions: { enabled: false },
  }),
]

if (process.env.HTTPS === 'true') {
  plugins.push(basicSsl())
}
// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Enables live reloading the electron renderer
      // when changes are made in the core package.
      '@tapes-monorepo/core': path.resolve(
        __dirname,
        '../../packages/core/dist/core.js',
      ),
      // Alias the core styles import to avoid naming conflict.
      '@tapes-monorepo/core-styles': path.resolve(
        __dirname,
        '../../packages/core/dist/core.css',
      ),
      // In dev, resolve the shared UI library to its TypeScript sources instead
      // of the bundle `vp build --watch` emits. Rolldown minifies that bundle
      // (`function n(...)`, `export { n as Button }`), so react-refresh cannot
      // recognise the exports as components and never installs an HMR boundary
      // — every edit in packages/ui bubbled up to a full page reload. The
      // sources get real Fast Refresh, and skip the watch-build hop entirely.
      // Builds keep using the package entry so the published bundle is what
      // ships.
      ...(command === 'serve'
        ? {
            '@tapes-monorepo/ui': path.resolve(
              __dirname,
              '../../packages/ui/lib/index.ts',
            ),
          }
        : {}),
    },
  },
  plugins,
  server: {
    // When a LAN guest is served the app from this dev server (for HMR), its
    // Automerge sync socket connects to `/sync` on the same origin. Proxy that
    // to the Electron host's embedded sync server, which runs on loopback of
    // this same machine (DEFAULT_SYNC_SERVER_PORT = 9001). `secure: false` lets
    // a `wss://` guest (dev:https) tunnel to the plain `ws://` loopback target.
    proxy: {
      '/sync': {
        target: `ws://127.0.0.1:${syncServerPort}`,
        ws: true,
        secure: false,
        changeOrigin: true,
      },
      // Recorded audio is fetched and uploaded over the same origin as the
      // sync socket, so it needs the same hop in development. Blobs are always
      // served by the embedded host itself, never by this dev server.
      '/blobs': {
        target: `http://127.0.0.1:${syncServerPort}`,
        secure: false,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
}))
