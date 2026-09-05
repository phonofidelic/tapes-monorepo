import path from 'path'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// This bundle is also staged into electron-client and served to LAN guests
// (`stage-web-client` sets this). Those guests get no service worker at all.
// See the `disable` option below and the unregister in src/main.tsx.
const servedByHost = process.env.VITE_SERVED_BY_HOST === 'true'

// Loopback port the `/sync` and `/blobs` proxies below hop to. The Electron
// host's embedded server owns 9001 (DEFAULT_SYNC_SERVER_PORT), which is what a
// developer running `yarn dev` beside the desktop app wants. The two-device e2e
// harness runs its own headless host on another port and sets this variable,
// so it never collides with a desktop app that is already running.
const syncServerPort = process.env.TAPES_SYNC_SERVER_PORT ?? '9001'

const plugins = [
  wasm(),
  topLevelAwait(),
  react(),
  VitePWA({
    // A host-served build emits no sw.js, no manifest and no injected head
    // tags. A LAN guest exists to sync with a live host, so offline caching
    // buys nothing. Plain-HTTP LAN mode is not a secure context, so a worker
    // could not register there anyway. HTTPS LAN mode runs on a self-signed
    // cert (electron-client/src/certManager.ts), where a wedged service worker
    // is hard for a guest to clear.
    disable: servedByHost,
    // Never swap the bundle out from under a recording in progress. The user
    // is told an update is ready and chooses when to take it (PwaUpdatePrompt).
    registerType: 'prompt',
    // Registration happens explicitly in ShellPrompts, not via an injected
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
          type: 'image/webp',
        },
      ],
    },
    workbox: {
      // Both settings are required for offline boot. Automerge's wasm is a
      // ~3.2 MB hashed asset that the bundle fetches at module-init time under
      // a top-level await. Workbox's defaults would drop it silently: `wasm`
      // is not in the default glob set, and the default 2 MiB size cap would
      // exclude it even if it were. The result would be a cached shell that
      // never mounts offline. scripts/verifyPrecache.mjs fails the build if
      // the wasm ever leaves the generated manifest.
      globPatterns: ['**/*.{js,css,html,wasm,ico,png,svg,webmanifest}'],
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      navigateFallback: 'index.html',
      // The Automerge socket connects to `/sync` on this origin. WebSocket
      // upgrades are not fetch events, so a worker never sees them, but this
      // guarantees the shell is never served in their place. `/blobs` requests
      // are fetches rather than navigations, so the fallback should not apply
      // to them either. Serving the app shell instead of audio bytes fails as
      // an opaque decode error, so it is ruled out explicitly.
      navigateFallbackDenylist: [/^\/sync/, /^\/blobs/],
      cleanupOutdatedCaches: true,
    },
    // Off on purpose. A worker on the dev server would fight the LAN-guest HMR
    // flow and the Playwright suite, which runs against `vite` dev by design.
    // See the webServer comment in playwright.config.ts.
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
      // In dev, resolve the shared UI library to its TypeScript sources rather
      // than the bundle `vp build --watch` emits. Rolldown minifies that
      // bundle, so react-refresh cannot recognise its exports as components
      // and never installs an HMR boundary. Every edit in packages/ui then
      // became a full page reload. The sources get real Fast Refresh and skip
      // the watch-build hop. Builds keep using the package entry so the
      // published bundle is what ships.
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
    // When a LAN guest loads the app from this dev server (for HMR), its
    // Automerge sync socket connects to `/sync` on the same origin. Proxy that
    // to the Electron host's embedded sync server on loopback of this same
    // machine. `secure: false` lets a `wss://` guest (dev:https) tunnel to the
    // plain `ws://` loopback target.
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
      // Playback events are posted to the same host as blobs.
      '/events': {
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
