import { defineConfig } from '@playwright/test'

const PORT = 4173
// `localhost`, not `127.0.0.1`: Vite's dev server binds the hostname, and the
// webServer health check fails against the bare loopback address.
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // CI provides a single pair of PulseAudio virtual sources, so parallel
  // recordings would contend for the same capture device.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Recording tests capture for ~4s and then poll OPFS for the written file.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // main.tsx renders <App> inside `div.flex sm:hidden`; at >= 640px only the
    // DownloadPrompt is visible. A plain narrow viewport rather than a device
    // preset, so touch emulation doesn't change click behaviour.
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
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            // Supplies the capture *samples*. Note it does NOT supply a capture
            // *device* on Linux: CI additionally loads PulseAudio virtual
            // sources, without which enumerateDevices() returns no audioinput
            // and getUserMedia throws NotFoundError.
            '--use-fake-device-for-media-capture',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    // The dev server, deliberately, not `vite preview`: React StrictMode does
    // not double-invoke in a production build, so the "exactly one
    // MediaRecorder" test would be a tautology against a built bundle.
    command: `yarn vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    // main.tsx throws without this. The app never contacts it: a fresh browser
    // profile has no stored automergeUrl, so App takes repo.create() rather
    // than repo.find(), which is what would need a reachable server.
    env: { VITE_SYNC_SERVER_URL: 'ws://127.0.0.1:9999' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
