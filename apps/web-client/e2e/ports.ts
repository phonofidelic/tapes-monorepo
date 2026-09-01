/**
 * Addresses the two-device suite pins down, shared by `playwright.config.ts`
 * (which starts the guest's dev server and points its proxies somewhere) and
 * `host.ts` (which starts the host those proxies hop to). They have to agree,
 * and the config cannot import `host.ts` without pulling Automerge's wasm into
 * config load, so the constants live on their own.
 */

/**
 * The headless host. Not 9001: the desktop app's embedded server owns that
 * one, and a developer running both should not have the suite bind over their
 * live library.
 */
export const HOST_PORT = 9101

/**
 * The guest's dev server. A second one, separate from the single-device
 * suite's on 4173, because the two differ in configuration rather than in
 * use: this one resolves sync to same-origin `/sync` (no
 * `VITE_SYNC_SERVER_URL`) and proxies both `/sync` and `/blobs` to the host.
 */
export const GUEST_PORT = 4176

/** Stands in for the token `sync-server.json` mints per install. */
export const PAIRING_TOKEN = 'e2e-pairing-token'
