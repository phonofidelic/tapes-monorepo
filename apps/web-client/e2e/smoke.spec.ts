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

  // Playwright's default pointer is fine, so the visible nav is the one App
  // renders beside main. The touch nav in the bottom dock is hidden.
  test('puts the nav in a sidebar beside main on a wide viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()

    const nav = await page.getByRole('navigation').boundingBox()
    const main = await page.locator('main').boundingBox()
    expect(nav).not.toBeNull()
    expect(main).not.toBeNull()

    // Side by side: main starts where the nav ends, at the same height.
    expect(Math.abs(main!.x - (nav!.x + nav!.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(main!.y - nav!.y)).toBeLessThanOrEqual(1)
    // Main takes the rest of the row rather than a centred column.
    expect(main!.x + main!.width).toBeGreaterThanOrEqual(1440 - 16 - 1)
  })

  test('puts the nav above main on a narrow viewport', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()

    const nav = await page.getByRole('navigation').boundingBox()
    const main = await page.locator('main').boundingBox()
    expect(nav).not.toBeNull()
    expect(main).not.toBeNull()

    expect(main!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 1)
    expect(main!.width).toBeGreaterThanOrEqual(390 - 16 - 1)
  })
})
