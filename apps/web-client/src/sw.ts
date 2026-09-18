/// <reference lib="webworker" />
/**
 * The web client's service worker. Built from this file by vite-plugin-pwa's
 * injectManifest strategy and emitted as `dist/sw.js`.
 *
 * It precaches the app shell and answers navigations from that cache when the
 * network is gone. Nothing is cached at runtime.
 *
 * The build replaces `self.__WB_MANIFEST` with the generated precache
 * manifest, so that expression has to reach the bundle unchanged. What lands in
 * the manifest is decided by the glob and size rules in vite.config.ts.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// `self` is typed as `Window` here, because the tsconfig loads the DOM lib
// alongside WebWorker. Assert to the service worker scope for the lifecycle
// calls below.
const serviceWorker = self as unknown as ServiceWorkerGlobalScope

// A new worker installs and then waits, because registration uses
// `registerType: 'prompt'` (see vite.config.ts). It takes over only when the
// page asks, which is the Reload button in PwaUpdatePrompt. Activating on
// install instead would swap the bundle out from under a recording.
serviceWorker.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    serviceWorker.skipWaiting()
  }
})

// The assertion is written inline rather than reusing `serviceWorker` above
// because the build injects the manifest by replacing the text
// `self.__WB_MANIFEST`. A type assertion compiles away and leaves it intact.
precacheAndRoute(
  (self as unknown as { __WB_MANIFEST: (PrecacheEntry | string)[] })
    .__WB_MANIFEST,
)

// Deletes precaches left behind by older versions of this worker.
cleanupOutdatedCaches()

// Navigations are answered with the cached app shell, so a reload works
// offline. The denied paths are answered by the Electron host, not by this
// bundle. `/sync` is a websocket upgrade, which a worker never sees as a fetch,
// but denying it guarantees the shell is never served in its place. `/blobs` is
// a fetch rather than a navigation, and handing back HTML instead of audio
// bytes fails as an opaque decode error. `/trust` and `/ca.crt` serve the
// host's root certificate, where the app shell is a confusing answer.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/sync/, /^\/blobs/, /^\/trust/, /^\/ca\.crt/],
  }),
)
