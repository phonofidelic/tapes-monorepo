import { defineConfig } from '@playwright/test'
import { GUEST_PORT, HOST_PORT } from './e2e/ports'

const PORT = 4173
// `localhost`, not `127.0.0.1`: Vite's dev server binds the hostname, and the
// webServer health check fails against the bare loopback address.
const BASE_URL = `http://localhost:${PORT}`

// The service worker is disabled in dev (see vite.config.ts), so the PWA specs
// need a real built bundle. `localhost` is a secure context even over plain
// http, so the worker registers here without TLS.
// Not 4174, Vite's own `preview` default. That one collides with any stray
// `vite preview` a sibling checkout left running, and --strictPort turns the
// collision into a failed run.
const PREVIEW_PORT = 4175
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`

// The two-device suite's guest. A dev server of its own rather than the one on
// 4173, because it is configured differently: no VITE_SYNC_SERVER_URL, so the
// app resolves sync to same-origin `/sync`, and both that and `/blobs` are
// proxied to the headless host the suite runs (see e2e/host.ts).
const GUEST_URL = `http://localhost:${GUEST_PORT}`

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
    // The app renders at every width, so this is not a requirement. It is the
    // default the recording specs were written against and the layout most of
    // them care about. Specs that need desktop widths call setViewportSize
    // themselves. A plain narrow viewport rather than a device preset, so touch
    // emulation does not change click behaviour.
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
      // These two have servers of their own.
      testIgnore: [/pwa\.spec\.ts/, /two-device\.spec\.ts/],
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
    {
      name: 'two-device',
      testMatch: /two-device\.spec\.ts/,
      use: {
        browserName: 'chromium',
        baseURL: GUEST_URL,
        launchOptions: {
          args: [
            // The guest records in one of these tests, same as the
            // single-device suite, and on Linux still needs CI's PulseAudio
            // virtual sources for a capture device to exist at all.
            '--use-fake-device-for-media-capture',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
    {
      name: 'pwa',
      testMatch: /pwa\.spec\.ts/,
      use: {
        browserName: 'chromium',
        baseURL: PREVIEW_URL,
      },
    },
  ],
  webServer: [
    {
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
    {
      // Builds first: `preview` serves dist/, and the turbo `e2e` task only
      // depends on *upstream* builds, so this workspace's own dist may be
      // absent or stale.
      command: `yarn build && yarn vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      // Blank, not a dummy address: it makes the build resolve to local-only,
      // which is the standalone-PWA case the offline spec is about. Left unset
      // it would inherit a developer's .env.local and stop being deterministic.
      env: { VITE_SYNC_SERVER_URL: '' },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The guest of the two-device suite. `VITE_SYNC_SERVER_URL` is blank on
      // purpose: it is the first link in the app's precedence chain, and a
      // value here would stop it ever reaching the dev-server case that
      // resolves sync to same-origin `/sync`, which is the path under test.
      command: `yarn vite --port ${GUEST_PORT} --strictPort`,
      url: GUEST_URL,
      env: {
        VITE_SYNC_SERVER_URL: '',
        // Where this server's `/sync` and `/blobs` proxies hop to. The host is
        // started by the suite itself, so this server can (and does) come up
        // before anything is listening there.
        TAPES_SYNC_SERVER_PORT: String(HOST_PORT),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
