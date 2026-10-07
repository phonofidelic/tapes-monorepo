import type { Readable } from 'stream'
import {
  HOST_RECEIPT_TYPE,
  RECORDING_CLAIM_TYPE,
  STATEMENT_MIME_TYPE,
  checkRecordingClaim,
  statementBytes,
  verifyStatement,
  type Signed,
} from '@tapes-monorepo/provenance'
import { BlobTooLargeError, type BlobStore } from './blobStore'

/**
 * Checks a signed statement sent to `/blobs`, so a client can copy a
 * recording's claim and receipt to a host that only had its audio.
 *
 * Any peer can make a key and sign, so a valid signature alone filters almost
 * nothing. Each statement must also bind to what this host already holds. A
 * claim needs its audio here, and a receipt needs its claim here.
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
  /** The receipt names a claim this host does not hold. */
  | 'claim-missing'

export type StatementCheck =
  { ok: true } | { ok: false; problem: StatementProblem }

const decoder = new TextDecoder('utf-8', { fatal: true })

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

function parseSigned(bytes: Uint8Array): Signed<unknown> | null {
  try {
    const value = JSON.parse(decoder.decode(bytes)) as Partial<
      Signed<unknown>
    > | null
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof value.signature !== 'string' ||
      !('payload' in value)
    ) {
      return null
    }
    return value as Signed<unknown>
  } catch {
    return null
  }
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
    return parseSigned(Buffer.concat(chunks))
  } catch {
    return null
  }
}

function payloadType(signed: Signed<unknown>): unknown {
  const payload = signed.payload as { type?: unknown } | null
  return typeof payload === 'object' && payload !== null
    ? payload.type
    : undefined
}

export async function checkUploadedStatement(
  bytes: Uint8Array,
  store: BlobStore,
): Promise<StatementCheck> {
  const signed = parseSigned(bytes)
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

  const type = payloadType(signed)
  if (type === RECORDING_CLAIM_TYPE) {
    return checkClaim(signed, store)
  }
  if (type === HOST_RECEIPT_TYPE) {
    return checkReceipt(signed, store)
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
  const payload = signed.payload as Record<string, unknown>
  if (
    typeof payload.claim !== 'string' ||
    typeof payload.receivedAt !== 'string' ||
    typeof payload.hostKey !== 'string'
  ) {
    return { ok: false, problem: 'malformed' }
  }
  // Only verified statements are stored under this MIME type. Any bytes can be
  // stored as audio, so the type alone would not show the claim was checked.
  const meta = await store.stat(payload.claim)
  const claim =
    meta?.mimeType === STATEMENT_MIME_TYPE
      ? await readStoredStatement(store, payload.claim)
      : null
  if (!claim || payloadType(claim) !== RECORDING_CLAIM_TYPE) {
    return { ok: false, problem: 'claim-missing' }
  }
  // Which host signed it is for readers to judge. Here it only has to be
  // intact.
  if (!(await verifyStatement(signed, payload.hostKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true }
}
