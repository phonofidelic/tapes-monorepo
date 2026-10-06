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

export type Statement = RecordingClaim | HostReceipt
