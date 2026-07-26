import { test, expect, type Page } from '@playwright/test'

/**
 * PWA packaging, against the `vite preview` server — the rest of the suite runs
 * on the dev server, where the service worker is deliberately disabled.
 *
 * The load-bearing assertion is the offline one. Automerge's ~3.2 MB wasm is
 * fetched at module-init time under a top-level await, so if it is not
 * precached the app installs, launches offline, and then never mounts. Workbox
 * would drop it silently under its own defaults; vite.config.ts overrides them.
 */

/**
 * Resolves once a service worker for this origin has reached `activated` —
 * which also means its install step, and so the precache, has completed.
 *
 * `expect.poll` around `page.evaluate`, not `page.waitForFunction`: the latter
 * treats a returned Promise as a truthy result and resolves on the first poll,
 * so an async predicate there silently waits for nothing.
 */
const waitForActiveServiceWorker = async (page: Page) => {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration()
          return registration?.active?.state ?? null
        }),
      { timeout: 60_000, message: 'service worker never reached activated' },
    )
    .toBe('activated')
}

test('serves a manifest and icons', async ({ page, request }) => {
  await page.goto('/')

  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)

  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({
    name: 'Tapes',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  })

  // Installability needs a 192 and a 512, and Android needs a maskable one.
  const icons = manifest.icons as {
    src: string
    sizes?: string
    purpose?: string
  }[]
  expect(icons.map((icon) => icon.sizes ?? '')).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
  expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true)

  // Every declared icon has to actually exist, or install silently fails.
  for (const icon of icons) {
    expect((await request.get(`/${icon.src}`)).status(), icon.src).toBe(200)
  }
})

test('precaches the Automerge wasm', async ({ page }) => {
  await page.goto('/')
  await waitForActiveServiceWorker(page)

  const cachedWasm = await page.evaluate(async () => {
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      const match = (await cache.keys()).find((request) =>
        new URL(request.url).pathname.endsWith('.wasm'),
      )
      if (match) return match.url
    }
    return null
  })

  expect(cachedWasm, 'no .wasm in Cache Storage').not.toBeNull()
})

test('launches and mounts offline after one load', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await waitForActiveServiceWorker(page)

  // A freshly installed worker activates but does not claim open pages
  // (generateSW leaves clientsClaim off), so the first reload is what puts the
  // page under its control. Without it, going offline would just fail the nav.
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  const failedUrls: string[] = []
  page.on('requestfailed', (request) => failedUrls.push(request.url()))

  await context.setOffline(true)
  try {
    await page.reload()

    // `<App>` renders "Loading..." until the Automerge repo resolves, and the
    // repo cannot exist unless the top-level-await wasm init completed — from
    // cache, since nothing can reach the network here. So the nav appearing is
    // the real proof the wasm was precached, not just the shell.
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()

    expect(
      failedUrls.filter((url) => url.endsWith('.wasm')),
      'the wasm went to the network while offline',
    ).toEqual([])
  } finally {
    await context.setOffline(false)
  }
})
