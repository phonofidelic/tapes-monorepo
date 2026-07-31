import { test, expect } from '@playwright/test'

test.describe('app shell', () => {
  test('boots and renders the recorder navigation', async ({ page }) => {
    await page.goto('/')

    // App renders "Loading..." until the Automerge repo resolves, so waiting
    // for the nav proves the repo was created without a reachable sync server.
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Library' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  })

  test('renders the app at desktop width as well as mobile (TAP-67)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()

    // main.tsx used to render <App> inside `div.flex sm:hidden`, so the whole
    // app was display:none from 640px up. Guards against that gate returning.
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Library' })).toBeVisible()
  })

  test('holds the content column to max-w-3xl on a wide viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()

    // `main` is the column (the Recorder view positions against it), so its
    // box is the 48rem max-width plus its own box-content padding.
    const main = page.locator('main')
    const box = await main.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeLessThanOrEqual(768 + 40 + 1)
    // Centred: equal gutters either side.
    expect(Math.abs(box!.x - (1440 - box!.width - box!.x))).toBeLessThanOrEqual(
      1,
    )
  })
})
