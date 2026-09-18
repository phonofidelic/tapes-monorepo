/// <reference lib="webworker" />
/**
 * The standalone deploy's service worker. Built from this file by
 * vite-plugin-pwa's injectManifest strategy and emitted as `dist/sw.js`.
 *
 * It precaches the app shell and answers navigations from that cache when the
 * network is gone. Nothing is cached at runtime. The bundle the desktop host
 * serves to LAN guests runs src/blobAuthSw.ts instead.
 *
 * The build injects the precache manifest by replacing the text
 * `self.__WB_MANIFEST`, so that expression has to survive into the built
 * worker. What lands in the manifest is decided in vite.config.ts.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// `self` is typed as `Window` here, because the tsconfig loads the DOM lib
// alongside WebWorker.
const serviceWorker = self as unknown as ServiceWorkerGlobalScope

// A new worker installs and then waits. This message is how the page hands it
// the go-ahead, and `registerType: 'prompt'` in vite.config.ts says why.
serviceWorker.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    serviceWorker.skipWaiting()
  }
})

// The assertion is inline, and not on `serviceWorker` above, so that the
// injection point still reads `self.__WB_MANIFEST` after it compiles away.
precacheAndRoute(
  (self as unknown as { __WB_MANIFEST: (PrecacheEntry | string)[] })
    .__WB_MANIFEST,
)

cleanupOutdatedCaches()

// Navigations are answered from the precache, so a reload works offline. The
// denied paths belong to the Electron host, not to this bundle, and the app
// shell is a confusing answer for all four. `/blobs` is the worst of them: HTML
// where audio bytes were expected fails as an opaque decode error.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/sync/, /^\/blobs/, /^\/trust/, /^\/ca\.crt/],
  }),
)
