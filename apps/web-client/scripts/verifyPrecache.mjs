/**
 * Build gate: fails if Automerge's WebAssembly module is missing from the
 * generated Workbox precache manifest.
 *
 * The bundle fetches that ~3.2 MB asset at module-init time under a top-level
 * await, so if it is not precached the app installs, launches offline, and then
 * never mounts. Workbox drops it *silently* under its own defaults — `wasm` is
 * absent from the default `globPatterns` and the default
 * `maximumFileSizeToCacheInBytes` is 2 MiB — which makes this exactly the kind
 * of regression nobody notices until they are on a plane. vite.config.ts
 * overrides both; this checks the override actually took.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webClientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceWorkerPath = path.join(webClientRoot, 'dist', 'sw.js')

// The host-served build disables vite-plugin-pwa entirely and emits no service
// worker, so there is nothing to check. Staying quiet here keeps
// `yarn workspace electron-client stage-web-client` working.
if (process.env.VITE_SERVED_BY_HOST === 'true') {
  process.exit(0)
}

let serviceWorker
try {
  serviceWorker = await readFile(serviceWorkerPath, 'utf8')
} catch {
  console.error(
    `verifyPrecache: expected a service worker at ${path.relative(process.cwd(), serviceWorkerPath)}, but none was emitted.\n` +
      'Is VitePWA still in the plugins array in vite.config.ts?',
  )
  process.exit(1)
}

// Workbox inlines the manifest as `precacheAndRoute([{url,revision},...])`, so
// matching the quoted URLs is enough and avoids parsing the bundle.
const precachedWasm = [...serviceWorker.matchAll(/"(\/?[^"]+\.wasm)"/g)].map(
  ([, url]) => url,
)

if (precachedWasm.length === 0) {
  console.error(
    'verifyPrecache: no .wasm entry in the precache manifest — the app will not boot offline.\n' +
      'Check `workbox.globPatterns` includes `wasm` and `workbox.maximumFileSizeToCacheInBytes`\n' +
      'is above the size of dist/assets/automerge_wasm_bg-*.wasm.',
  )
  process.exit(1)
}

console.log(`verifyPrecache: ${precachedWasm.join(', ')} is precached.`)
