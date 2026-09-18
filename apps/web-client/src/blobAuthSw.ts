/// <reference lib="webworker" />
/**
 * The service worker for the bundle the desktop host serves to LAN guests.
 * Built to `dist/blobAuthSw.js` and registered from src/main.tsx.
 *
 * It adds the pairing token to `/blobs` requests and does nothing else. It
 * precaches nothing and answers nothing from a cache, so it cannot serve a
 * stale bundle. Keep it that way. The standalone deploy's worker is src/sw.ts.
 */
import {
  authorizeBlobRequest,
  isBlobRequest,
  readPairingToken,
} from './blobAuth'

// `self` is typed as `Window` here, because the tsconfig loads the DOM lib
// alongside WebWorker.
const serviceWorker = self as unknown as ServiceWorkerGlobalScope

// Take control on the first load instead of the next one. There is no bundle
// to swap out, and a guest whose playback only works after a reload looks
// broken.
serviceWorker.addEventListener('install', () => {
  serviceWorker.skipWaiting()
})

serviceWorker.addEventListener('activate', (event) => {
  event.waitUntil(serviceWorker.clients.claim())
})

serviceWorker.addEventListener('fetch', (event) => {
  // This decision has to be synchronous. `respondWith` after an await is too
  // late, and everything that is not a blob request must fall through to the
  // network untouched.
  if (!isBlobRequest(event.request, serviceWorker.location.origin)) {
    return
  }
  event.respondWith(
    (async () => {
      const token = await readPairingToken()
      if (!token) {
        // Not paired. The host answers 401 and the player reports it, which is
        // what an unauthenticated page would have seen anyway.
        return fetch(event.request)
      }
      return fetch(authorizeBlobRequest(event.request, token))
    })(),
  )
})
