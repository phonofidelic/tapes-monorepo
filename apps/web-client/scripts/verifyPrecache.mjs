/**
 * Build gate: fails if Automerge's WebAssembly module is missing from the
 * precache manifest injected into the built service worker. The bundle fetches
 * that ~3.2 MB asset at module-init time under a top-level await, so without it
 * the app installs, launches offline, and never mounts. Workbox drops it
 * silently under its own defaults: `wasm` is not in the default globs and the
 * default size cap is 2 MiB. vite.config.ts overrides both. This script checks
 * the override took.
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

// The injected manifest is an array of `{url, revision}` objects, so matching
// the quoted URLs is enough and avoids parsing the bundle. Either quote style,
// because the worker's own bundler picks it.
const precachedWasm = [
  ...serviceWorker.matchAll(/["'](\/?[^"']+\.wasm)["']/g),
].map(([, url]) => url)

if (precachedWasm.length === 0) {
  console.error(
    'verifyPrecache: no .wasm entry in the precache manifest — the app will not boot offline.\n' +
      'Check `injectManifest.globPatterns` includes `wasm` and\n' +
      '`injectManifest.maximumFileSizeToCacheInBytes` is above the size of\n' +
      'dist/assets/automerge_wasm_bg-*.wasm.',
  )
  process.exit(1)
}

console.log(`verifyPrecache: ${precachedWasm.join(', ')} is precached.`)
