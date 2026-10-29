/**
 * Signed provenance statements for recordings and sessions: their types,
 * canonical JSON, and Ed25519 signing over WebCrypto. Also the wrapping
 * format for person keys, which a passphrase or a passkey unlocks.
 *
 * The device that records signs the claim, guest or host. A person key
 * certifies a guest's device key, or a host vouches for it after a lost key.
 * Either can later be revoked, for a phone that was lost or stolen. The host,
 * in the Electron main process, verifies claims and signs receipts and session
 * records. The main process cannot import core, so the shared rules live here.
 * Keep this package free of React and Node APIs. WebCrypto is the one platform
 * API it uses, because browsers and Node both provide it.
 */

export * from './canonicalJson'
export * from './deviceCertificate'
export * from './deviceRevocation'
export * from './deviceVouch'
export * from './encoding'
export * from './hostReceipt'
export * from './passkeyRecord'
export * from './personKeyBackup'
export * from './recordingClaim'
export * from './recordingProvenance'
export * from './sessionRecord'
export * from './signing'
export * from './syncProof'
export * from './types'
