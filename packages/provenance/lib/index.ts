/**
 * Signed provenance statements for recordings: their types, canonical JSON,
 * and Ed25519 signing over WebCrypto.
 *
 * Guests sign claims and the host, in the Electron main process, verifies them
 * and signs receipts. The main process cannot import core, so the shared rules
 * live here. Keep this package free of React and Node APIs. WebCrypto is the
 * one platform API it uses, because browsers and Node both provide it.
 */

export * from './canonicalJson'
export * from './encoding'
export * from './signing'
export * from './types'
