/**
 * What the host does with a recording claim when the audio arrives: check it
 * against the bytes it received, then countersign it with a receipt.
 *
 * The receipt's time comes from the host's clock. A device can set its own
 * clock to anything, so the receipt is the independent record of when.
 */

import {
  exportPublicKey,
  signStatement,
  statementAddress,
  verifyStatement,
} from './signing'
import {
  HOST_RECEIPT_TYPE,
  RECORDING_CLAIM_TYPE,
  type HostReceipt,
  type RecordingClaim,
  type Signed,
} from './types'

/** Why a claim did not verify. */
export type ClaimProblem =
  /** Not a signed recording claim at all. */
  | 'malformed'
  /** The recorder hashed different bytes from the ones the host received. */
  | 'hash-mismatch'
  | 'size-mismatch'
  /** The signature does not verify against the device key the claim names. */
  | 'bad-signature'

export type ClaimCheck =
  | { ok: true; claim: Signed<RecordingClaim> }
  | { ok: false; problem: ClaimProblem }

/**
 * The outcome of ingesting an upload's claim, as the host reports it back to
 * the uploader. `receipt` is the encoded signed receipt. It is absent from a
 * verified claim only when the host could not load its own signing key.
 */
export type ClaimVerification =
  | { status: 'unsigned' }
  | { status: 'unverified'; problem: ClaimProblem }
  | { status: 'verified'; receipt?: string }

function isRecordingClaim(payload: unknown): payload is RecordingClaim {
  const claim = payload as Partial<RecordingClaim> | null
  return (
    typeof claim === 'object' &&
    claim !== null &&
    claim.type === RECORDING_CLAIM_TYPE &&
    typeof claim.blob === 'object' &&
    claim.blob !== null &&
    typeof claim.blob.hash === 'string' &&
    typeof claim.blob.size === 'number' &&
    typeof claim.blob.mimeType === 'string' &&
    typeof claim.startedAt === 'string' &&
    typeof claim.endedAt === 'string' &&
    typeof claim.sessionId === 'string' &&
    typeof claim.deviceKey === 'string'
  )
}

/**
 * Checks a claim against the bytes the host received. The MIME type is not
 * compared: it labels the bytes, and the hash already pins them.
 *
 * Verifying against the key the claim names proves the claim is intact, not
 * which person made it. That needs device certificates.
 */
export async function checkRecordingClaim(
  signed: Signed<unknown>,
  received: { hash: string; size: number },
): Promise<ClaimCheck> {
  const { payload } = signed
  if (!isRecordingClaim(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (payload.blob.hash !== received.hash) {
    return { ok: false, problem: 'hash-mismatch' }
  }
  if (payload.blob.size !== received.size) {
    return { ok: false, problem: 'size-mismatch' }
  }
  if (!(await verifyStatement(signed, payload.deviceKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, claim: { payload, signature: signed.signature } }
}

/** Countersigns a claim the host has already checked. */
export async function createHostReceipt(
  claim: Signed<RecordingClaim>,
  hostKeyPair: CryptoKeyPair,
  receivedAt: Date,
): Promise<Signed<HostReceipt>> {
  return signStatement(
    {
      type: HOST_RECEIPT_TYPE,
      claim: await statementAddress(claim),
      receivedAt: receivedAt.toISOString(),
      hostKey: await exportPublicKey(hostKeyPair.publicKey),
    },
    hostKeyPair.privateKey,
  )
}
