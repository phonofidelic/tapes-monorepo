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

  test('renders the app rather than the download prompt at mobile width', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()

    // Above the `sm` breakpoint main.tsx swaps the app for DownloadPrompt.
    // Guards the viewport requirement that every other test depends on.
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeHidden()
  })
})
