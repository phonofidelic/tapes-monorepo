import { defineConfig } from '@playwright/test'
import { GUEST_PORT, GUEST_URL, SYNC_PORT } from './e2e/ports'

/**
 * The desktop app's own e2e suite.
 *
 * Separate from `apps/web-client/playwright.config.ts` on purpose. That one
 * runs on every PR against a Linux runner; this one launches a *packaged*
 * Electron app and records through `sox`, which is macOS-only and needs a real
 * audio input — so it runs nightly on a macOS runner (see
 * `.github/workflows/e2e-electron.yml`) rather than blocking every PR.
 */

export default defineConfig({
  testDir: './e2e',
  // Packages the app before anything runs; see the file for why not a hook.
  globalSetup: './e2e/globalSetup.ts',
  // One app, one audio device, one library: these tests share a launched app
  // and would contend for the default input if they overlapped.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One retry on CI, none locally. Both shells capture from a real audio device
  // here, and the browser guest's `MediaRecorder` intermittently yields an empty
  // file — measured failing roughly one run in five, and the same on the
  // web-client suite, which retries twice for the same reason. One is enough to
  // keep a nightly honest without hiding a test that fails consistently.
  retries: process.env.CI ? 1 : 0,
  // Each test records for ~4s and then waits on a descriptor reaching a peer;
  // the first test in a run also waits out the app's launch.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    // The browser guest's origin. The renderer is reached through Playwright's
    // Electron handle instead, and never navigates.
    baseURL: GUEST_URL,
    viewport: { width: 390, height: 844 },
    // AudioInputSelector reads navigator.permissions.query once on mount and
    // never re-checks, so the grant has to be in place before the first load.
    permissions: ['microphone'],
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron-renderer',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            // For the guest, which records in the browser. The renderer's own
            // recording goes through `sox` and no flag can fake it — see
            // `e2e/capture.ts`.
            '--use-fake-device-for-media-capture',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      // The web-client's own dev server, run from this workspace as the guest.
      // `VITE_SYNC_SERVER_URL` is blank on purpose: it is the first link in the
      // app's precedence chain, and a value here would stop it ever reaching
      // the dev-server case that resolves sync to same-origin `/sync` — which
      // is then proxied to the app under test.
      command: `yarn vite --port ${GUEST_PORT} --strictPort`,
      cwd: '../web-client',
      url: GUEST_URL,
      env: {
        VITE_SYNC_SERVER_URL: '',
        // Where this server's `/sync` and `/blobs` proxies hop to. The app is
        // launched by the suite itself and reads the same variable to pin its
        // embedded server there, so this server can (and does) come up before
        // anything is listening.
        TAPES_SYNC_SERVER_PORT: String(SYNC_PORT),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
