import { test, expect, type Page } from '@playwright/test'

/**
 * The install affordance (TAP-67).
 *
 * Chromium will not fire a real `beforeinstallprompt` for a dev-server origin,
 * and there is no automation hook to force one, so these tests dispatch a
 * synthetic event carrying the same shape the app consumes. That still
 * exercises the real path: the listener is attached at module scope in
 * installPromptStore.ts, and the component reads the stored event.
 */

const INSTALL_COPY = 'Install Tapes on this device to use it offline.'

async function fireBeforeInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string; platform: string }>
    }
    event.prompt = () => {
      window.__installPromptCalled = true
      return Promise.resolve()
    }
    event.userChoice = Promise.resolve({
      outcome: 'accepted',
      platform: 'web',
    })
    window.dispatchEvent(event)
  })
}

test.describe('install prompt', () => {
  test('is absent until the browser says the app is installable', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await expect(page.getByText(INSTALL_COPY)).toBeHidden()

    await fireBeforeInstallPrompt(page)
    await expect(page.getByText(INSTALL_COPY)).toBeVisible()
  })

  test('Install reaches the deferred event and clears the toast', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await fireBeforeInstallPrompt(page)

    await page.getByRole('button', { name: 'Install' }).click()

    await expect
      .poll(() => page.evaluate(() => window.__installPromptCalled === true))
      .toBe(true)
    await expect(page.getByText(INSTALL_COPY)).toBeHidden()
  })

  // Split in two rather than dismiss-then-reload: a reloaded profile has an
  // automergeUrl in storage, so App takes repo.find() against the dummy sync
  // server and never resolves (see the webServer note in playwright.config.ts).
  test('Not now records the dismissal in the settings blob', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await fireBeforeInstallPrompt(page)
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByText(INSTALL_COPY)).toBeHidden()

    const dismissed = await page.evaluate(() => {
      const settings: unknown = JSON.parse(
        window.localStorage.getItem('settings') ?? '{}',
      )
      return (settings as { installPromptDismissed?: unknown })
        .installPromptDismissed
    })
    expect(dismissed).toBe(true)
  })

  test('stays hidden for a visitor who dismissed it before', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'settings',
        JSON.stringify({ installPromptDismissed: true }),
      )
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await fireBeforeInstallPrompt(page)

    await expect(page.getByText(INSTALL_COPY)).toBeHidden()
  })

  test('stays hidden when already running standalone', async ({ page }) => {
    // Playwright's emulateMedia has no display-mode option, so stub the query
    // the app actually calls. Installed via addInitScript so it is in place
    // before installPromptStore.ts runs.
    await page.addInitScript(() => {
      const realMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query: string) =>
        query.includes('display-mode: standalone')
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addEventListener: () => {},
              removeEventListener: () => {},
              addListener: () => {},
              removeListener: () => {},
              dispatchEvent: () => false,
            } as MediaQueryList)
          : realMatchMedia(query)
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
    await fireBeforeInstallPrompt(page)

    await expect(page.getByText(INSTALL_COPY)).toBeHidden()
  })
})
