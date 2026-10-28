import type { Readable } from 'stream'
import {
  DEVICE_CERTIFICATE_TYPE,
  DEVICE_REVOCATION_TYPE,
  DEVICE_VOUCH_TYPE,
  HOST_RECEIPT_TYPE,
  RECORDING_CLAIM_TYPE,
  SESSION_RECORD_TYPE,
  STATEMENT_MIME_TYPE,
  checkDeviceLink,
  checkDeviceRevocation,
  checkHostReceipt,
  checkRecordingClaim,
  checkSessionRecord,
  parseSignedStatement,
  revocationCovers,
  statementAddress,
  statementBytes,
  statementType,
  type DeviceLink,
  type RecordingClaim,
  type Signed,
} from '@tapes-monorepo/provenance'
import { BlobTooLargeError, type BlobStore } from './blobStore'

/**
 * Checks a signed statement sent to `/blobs`, so a client can copy a
 * recording's claim, receipt and session record to a host that only had its
 * audio.
 *
 * Any peer can make a key and sign, so a valid signature alone filters almost
 * nothing. Each statement must also bind to what this host already holds. A
 * claim needs its audio here. A receipt needs its claim here, and a session
 * record needs at least one of the claims it lists. A device certificate or
 * vouch needs the claim that names it, which the uploader identifies with
 * `?for=`. A revocation needs the certificate or vouch it withdraws, and its
 * signer must have been able to withdraw that one. A vouch from another host
 * is kept. Whether to trust that host is for readers to judge, as with
 * receipts.
 *
 * Do not import `electron` here. The sync server uses this module, and it
 * stays testable in a plain node process.
 */

/** Statements are a few hundred bytes. This is a stop, not a policy. */
export const MAX_STATEMENT_BYTES = 64 * 1024

/** Why an uploaded statement was not stored. */
export type StatementProblem =
  /** Not a signed statement of the shape its type requires. */
  | 'malformed'
  | 'bad-signature'
  /** The claim describes different bytes from the audio this host holds. */
  | 'hash-mismatch'
  | 'size-mismatch'
  /** The bytes are not the statement's canonical JSON. */
  | 'not-canonical'
  | 'unknown-type'
  /** The claim names audio this host does not hold. */
  | 'audio-missing'
  /** The receipt or session record names no claim this host holds. */
  | 'claim-missing'
  /** The claim named by `?for=` does not name this certificate or vouch. */
  | 'certificate-mismatch'
  /** The revocation withdraws a certificate or vouch this host does not hold. */
  | 'certificate-missing'
  /** The signer of the revocation could not withdraw that statement. */
  | 'revocation-not-permitted'

export type StatementCheck =
  { ok: true } | { ok: false; problem: StatementProblem }

/** Reads a whole request body, failing once it passes `maxBytes`. */
export async function readStatementBody(
  source: Readable,
  maxBytes = MAX_STATEMENT_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of source as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > maxBytes) {
      throw new BlobTooLargeError(maxBytes)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** A statement from the store, or null if it is absent or not a statement. */
export async function readStoredStatement(
  store: BlobStore,
  hash: string,
): Promise<Signed<unknown> | null> {
  if (!(await store.has(hash))) {
    return null
  }
  try {
    const chunks: Buffer[] = []
    for await (const chunk of store.read(hash)) {
      chunks.push(chunk as Buffer)
    }
    return parseSignedStatement(Buffer.concat(chunks)) ?? null
  } catch {
    return null
  }
}

export async function checkUploadedStatement(
  bytes: Uint8Array,
  store: BlobStore,
  options: { forClaim?: string } = {},
): Promise<StatementCheck> {
  const signed = parseSignedStatement(bytes)
  if (!signed) {
    return { ok: false, problem: 'malformed' }
  }

  // The store files bytes under their hash. Only the canonical form hashes to
  // the address other statements and the doc use.
  let canonical: Uint8Array
  try {
    canonical = statementBytes(signed)
  } catch {
    return { ok: false, problem: 'malformed' }
  }
  if (!Buffer.from(canonical).equals(Buffer.from(bytes))) {
    return { ok: false, problem: 'not-canonical' }
  }

  const type = statementType(signed)
  if (type === RECORDING_CLAIM_TYPE) {
    return checkClaim(signed, store)
  }
  if (type === HOST_RECEIPT_TYPE) {
    return checkReceipt(signed, store)
  }
  if (type === SESSION_RECORD_TYPE) {
    return checkSession(signed, store)
  }
  if (type === DEVICE_CERTIFICATE_TYPE || type === DEVICE_VOUCH_TYPE) {
    return checkDeviceLinkUpload(signed, store, options.forClaim)
  }
  if (type === DEVICE_REVOCATION_TYPE) {
    return checkRevocationUpload(signed, store)
  }
  return { ok: false, problem: 'unknown-type' }
}

async function checkClaim(
  signed: Signed<unknown>,
  store: BlobStore,
): Promise<StatementCheck> {
  const hash = (signed.payload as { blob?: { hash?: unknown } }).blob?.hash
  const audio = typeof hash === 'string' ? await store.stat(hash) : null
  if (!audio) {
    return { ok: false, problem: 'audio-missing' }
  }
  const check = await checkRecordingClaim(signed, audio)
  return check.ok ? { ok: true } : { ok: false, problem: check.problem }
}

async function checkReceipt(
  signed: Signed<unknown>,
  store: BlobStore,
): Promise<StatementCheck> {
  // Which host signed it is for readers to judge. Here it only has to be
  // intact.
  const check = await checkHostReceipt(signed)
  if (!check.ok) {
    return { ok: false, problem: check.problem }
  }
  return (await holdsClaim(store, check.receipt.payload.claim))
    ? { ok: true }
    : { ok: false, problem: 'claim-missing' }
}

async function checkSession(
  signed: Signed<unknown>,
  store: BlobStore,
): Promise<StatementCheck> {
  const check = await checkSessionRecord(signed)
  if (!check.ok) {
    return { ok: false, problem: check.problem }
  }
  // One is enough. The other claims in a session may belong to recordings
  // this host was never sent.
  for (const address of check.record.payload.claims) {
    if (await holdsClaim(store, address)) {
      return { ok: true }
    }
  }
  return { ok: false, problem: 'claim-missing' }
}

async function checkDeviceLinkUpload(
  signed: Signed<unknown>,
  store: BlobStore,
  forClaim: string | undefined,
): Promise<StatementCheck> {
  const check = await checkDeviceLink(signed)
  if (!check.ok) {
    return { ok: false, problem: check.problem }
  }
  const claim = forClaim ? await storedClaim(store, forClaim) : null
  if (!claim) {
    return { ok: false, problem: 'claim-missing' }
  }
  const matches =
    claim.payload.deviceCert === (await statementAddress(check.link)) &&
    claim.payload.deviceKey === check.link.payload.deviceKey
  return matches ? { ok: true } : { ok: false, problem: 'certificate-mismatch' }
}

/**
 * A revocation is stored only once the statement it withdraws is here. That
 * also keeps out revocations about devices this host has never seen. Which
 * person or host signed it is not this host's judgement to make, so the only
 * question is whether they could withdraw that statement at all.
 */
async function checkRevocationUpload(
  signed: Signed<unknown>,
  store: BlobStore,
): Promise<StatementCheck> {
  const check = await checkDeviceRevocation(signed)
  if (!check.ok) {
    return { ok: false, problem: check.problem }
  }
  const { deviceLink } = check.revocation.payload
  const link = await storedLink(store, deviceLink)
  if (!link) {
    return { ok: false, problem: 'certificate-missing' }
  }
  return revocationCovers(check.revocation.payload, link.payload, deviceLink)
    ? { ok: true }
    : { ok: false, problem: 'revocation-not-permitted' }
}

/** The verified certificate or vouch stored here under this address. */
async function storedLink(
  store: BlobStore,
  address: string,
): Promise<Signed<DeviceLink> | null> {
  const meta = await store.stat(address)
  if (meta?.mimeType !== STATEMENT_MIME_TYPE) {
    return null
  }
  const stored = await readStoredStatement(store, address)
  if (!stored) {
    return null
  }
  const check = await checkDeviceLink(stored)
  return check.ok ? check.link : null
}

/** Whether a verified claim is stored here under this address. */
async function holdsClaim(store: BlobStore, address: string): Promise<boolean> {
  return (await storedClaim(store, address)) !== null
}

/** The verified claim stored here under this address, if there is one. */
async function storedClaim(
  store: BlobStore,
  address: string,
): Promise<Signed<RecordingClaim> | null> {
  // Only verified statements are stored under this MIME type. Any bytes can be
  // stored as audio, so the type alone would not show the claim was checked.
  const meta = await store.stat(address)
  const claim =
    meta?.mimeType === STATEMENT_MIME_TYPE
      ? await readStoredStatement(store, address)
      : null
  return claim !== null && statementType(claim) === RECORDING_CLAIM_TYPE
    ? (claim as Signed<RecordingClaim>)
    : null
}
