/**
 * The signed statements Tapes stores next to the audio.
 *
 * Each statement's `type` names its format and version. Never change the
 * fields of a published version: old signatures must keep verifying. Add a new
 * version such as `tapes/recording@2` instead.
 */

/**
 * A statement with a signature over the canonical JSON of its payload. Who
 * signed it is not part of the wrapper. Each payload names its signer's key.
 */
export type Signed<T> = { payload: T; signature: string }

export const RECORDING_CLAIM_TYPE = 'tapes/recording@1'

/** Signed by the recording device when recording stops. */
export type RecordingClaim = {
  type: typeof RECORDING_CLAIM_TYPE
  /** What the device captured, hashed by the device before upload. */
  blob: { hash: string; size: number; mimeType: string }
  startedAt: string
  endedAt: string
  sessionId: string
  /** The signer's base64url Ed25519 public key. */
  deviceKey: string
  /**
   * Address of the DeviceCertificate vouching for the device key. Absent until
   * devices have certificates.
   */
  deviceCert?: string
}

export const HOST_RECEIPT_TYPE = 'tapes/receipt@1'

/** Signed by the host once it has checked a claim against the bytes it got. */
export type HostReceipt = {
  type: typeof HOST_RECEIPT_TYPE
  /** Address of the Signed<RecordingClaim>. */
  claim: string
  /** The host's clock, not the device's. */
  receivedAt: string
  /** The signer's base64url Ed25519 public key. */
  hostKey: string
}

export const SESSION_RECORD_TYPE = 'tapes/session@1'

/** One stretch of time a device was connected to the host. */
export type SessionSpan = { joinedAt: string; leftAt: string }

/** A device that proved it holds its key while connected to the session. */
export type SessionDevice = {
  /** The device's base64url Ed25519 public key. */
  deviceKey: string
  /** The name the device gave on its most recent connection. Unverified. */
  label?: string
  /** Oldest first, clipped to the session. A device can drop and rejoin. */
  spans: SessionSpan[]
}

/** Signed by the host when a session closes. All times are the host's clock. */
export type SessionRecord = {
  type: typeof SESSION_RECORD_TYPE
  sessionId: string
  openedAt: string
  closedAt: string
  /** Sorted by device key, so the same session always signs the same bytes. */
  devices: SessionDevice[]
  /**
   * Addresses of the Signed<RecordingClaim>s the host accepted for this
   * session, sorted.
   */
  claims: string[]
  /** The signer's base64url Ed25519 public key. */
  hostKey: string
}

export const SYNC_PROOF_TYPE = 'tapes/sync-proof@1'

/**
 * Signed by a guest to show the host it holds its device key. It is sent on
 * the sync socket's upgrade request and never stored.
 */
export type SyncProof = {
  type: typeof SYNC_PROOF_TYPE
  /** The one-time value the host issued for this connection. */
  challenge: string
  /** The signer's base64url Ed25519 public key. */
  deviceKey: string
}

export type Statement = RecordingClaim | HostReceipt | SessionRecord
