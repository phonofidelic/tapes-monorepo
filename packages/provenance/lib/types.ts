/**
 * The signed statements Tapes stores next to the audio, and the signed
 * messages a guest sends a host.
 *
 * Each statement's `type` names its format and version. Never change the
 * fields of a published version: old signatures must keep verifying. Add a new
 * version such as `tapes/recording@2` instead.
 *
 * Sync proofs, join requests and vouch requests are checked once and never
 * stored, so that rule does not bind them. They still carry a versioned
 * `type`. It keeps a signature over one kind of message from verifying as
 * another made by the same key, and lets a host refuse an old shape.
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
   * Address of the Signed<DeviceCertificate> or Signed<DeviceVouch> that ties
   * the device key to a person. Absent when the device has no person key, such
   * as the host.
   */
  deviceCert?: string
}

export const DEVICE_CERTIFICATE_TYPE = 'tapes/device-cert@1'

/**
 * Signed by a person key to say a device key records for that person. It is
 * issued once per device and stored in the blob store next to the claims that
 * name it.
 */
export type DeviceCertificate = {
  type: typeof DEVICE_CERTIFICATE_TYPE
  /** The signer's base64url Ed25519 public key. */
  personKey: string
  /** The certified device's base64url Ed25519 public key. */
  deviceKey: string
  /** The device's name when the certificate was issued. */
  deviceLabel: string
  /** The device's clock. */
  issuedAt: string
}

export const JOIN_REQUEST_TYPE = 'tapes/join@1'

/**
 * Signed by a person key to join a host's roster, or to update the name or PIN
 * it has there. It is signed over a challenge from that host, so it cannot be
 * replayed. A certificate alone cannot do this job, because any paired peer
 * can read one from the blob store. Never stored.
 */
export type JoinRequest = {
  type: typeof JOIN_REQUEST_TYPE
  /** The signer's base64url Ed25519 public key. */
  personKey: string
  /** What the person wants the host to call them. */
  personName: string
  /** Address of the Signed<DeviceCertificate> sent with the request. */
  certificate: string
  /** The one-time value the host issued for this request. */
  challenge: string
}

export const VOUCH_REQUEST_TYPE = 'tapes/vouch-request@1'

/**
 * Signed by a new device key to ask a host to vouch for it as a person the
 * host already knows. It proves the requester holds the key. The person it
 * names is only a claim until the operator or a PIN confirms it. Never stored.
 */
export type VouchRequest = {
  type: typeof VOUCH_REQUEST_TYPE
  /** The signer's base64url Ed25519 public key. */
  deviceKey: string
  /** The person key the requester says is theirs. */
  personKey: string
  deviceLabel: string
  /** The device's clock. */
  requestedAt: string
}

export const PASSKEY_RECORD_WRITE_TYPE = 'tapes/passkey-record@1'

/**
 * Signed by a person key to store or replace the passkey record kept under
 * one credential id. Holding the pairing token is not enough to write one:
 * without this, any paired peer could overwrite a person's only way back from
 * a lost phone. It is signed over a challenge from the host, so it cannot be
 * replayed to restore an older record. Never stored.
 */
export type PasskeyRecordWrite = {
  type: typeof PASSKEY_RECORD_WRITE_TYPE
  /** The signer's base64url Ed25519 public key. */
  personKey: string
  /** The base64url credential id of the passkey that unlocks the record. */
  credentialId: string
  /** sha-256 of the record's text form, so the signature covers the bytes. */
  record: string
  /** The one-time value the host issued for this write. */
  challenge: string
}

export const DEVICE_VOUCH_TYPE = 'tapes/device-vouch@1'

/** How the person showed the host it was them. */
export type VouchMethod = 'operator' | 'pin'

/**
 * Signed by a host to say it saw the person who holds `personKey` take up
 * `deviceKey`. The host never holds the person key, so this is a witness
 * statement, weaker than a device certificate. A device uses it in place of a
 * certificate until the person restores their person key.
 */
export type DeviceVouch = {
  type: typeof DEVICE_VOUCH_TYPE
  /** The signer's base64url Ed25519 public key. */
  hostKey: string
  /** The host's own name for itself. Unverified, like a device label. */
  hostLabel: string
  personKey: string
  /** The name the host's roster gives the person. The person did not sign it. */
  personName: string
  /** The new device's base64url Ed25519 public key. */
  deviceKey: string
  /** The new device's name, from its vouch request. */
  deviceLabel: string
  method: VouchMethod
  /**
   * Address of the Signed<DeviceCertificate> the person key signed when the
   * person first joined this host. It ties the vouch to the person key.
   */
  firstCertificate: string
  /** The host's clock. */
  vouchedAt: string
}

export const DEVICE_REVOCATION_TYPE = 'tapes/revocation@1'

/** Who withdrew their trust in a device key, and so what the statement says. */
export type RevocationSigner = 'person' | 'host'

/** Why a device key should no longer be trusted. */
export type RevocationReason = 'lost' | 'retired' | 'wrong-person'

/**
 * Signed to say a device key should no longer be trusted, for a lost or
 * stolen phone. A person key revokes any certificate it signed, and any vouch
 * made in its name. A host revokes a vouch it signed itself, such as after the
 * operator confirmed the wrong person. Neither can revoke the other's
 * statement, so `signedBy` says which rule applies.
 *
 * A revocation does not undo a recording. It says when trust in the device
 * ended, and a reader compares that with the host's receipt time.
 */
export type DeviceRevocation = {
  type: typeof DEVICE_REVOCATION_TYPE
  /** The signer's base64url Ed25519 public key. */
  signerKey: string
  signedBy: RevocationSigner
  /** The device key that should no longer be trusted. */
  deviceKey: string
  /**
   * Address of the Signed<DeviceCertificate> or Signed<DeviceVouch> this
   * withdraws. One statement is revoked at a time, so a person who certified
   * a device twice revokes both certificates.
   */
  deviceLink: string
  reason: RevocationReason
  /** The signer's clock. */
  revokedAt: string
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

export type Statement =
  | RecordingClaim
  | HostReceipt
  | SessionRecord
  | DeviceCertificate
  | DeviceVouch
  | DeviceRevocation
