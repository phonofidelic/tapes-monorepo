/**
 * Addresses the electron e2e suite pins down, shared by `playwright.config.ts`
 * (which starts the guest's dev server and aims its proxies somewhere) and
 * `electronApp.ts` (which launches the app those proxies hop to). They have to
 * agree, and the config cannot import `electronApp.ts` without pulling
 * Playwright's electron launcher into config load, so the constants live on
 * their own.
 */

/**
 * The app under test's embedded sync server. Not 9001, the app's own default:
 * a developer running the real desktop app already holds that, and the second
 * copy this suite launches would silently land on an OS-assigned port that
 * nothing is proxying to. Nor 9101, which the web-client suite's headless host
 * takes.
 */
export const SYNC_PORT = 9102

/**
 * The guest's dev server. The web-client's own, started from this workspace
 * with no `VITE_SYNC_SERVER_URL` so the app resolves sync to same-origin
 * `/sync`, and with both that and `/blobs` proxied to the app under test. A
 * port of its own, so a web-client e2e run in a sibling checkout is undisturbed.
 */
export const GUEST_PORT = 4177

export const GUEST_URL = `http://localhost:${GUEST_PORT}`
