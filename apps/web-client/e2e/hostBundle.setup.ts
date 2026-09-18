import { test } from '@playwright/test'
import { buildHostBundle } from './hostBundle'

/**
 * Builds the bundle the streaming suite's host serves. A setup project rather
 * than a `webServer` entry, because nothing here listens on a port: the host
 * the suite starts serves the files itself.
 */
test('build the host-served bundle', async () => {
  // A cold Vite build of this app, wasm and all, runs well past the file-wide
  // budget the specs are sized for.
  test.setTimeout(600_000)
  await buildHostBundle()
})
