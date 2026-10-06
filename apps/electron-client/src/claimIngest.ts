import { Readable } from 'stream'
import { buffer } from 'stream/consumers'
import {
  HOST_RECEIPT_TYPE,
  STATEMENT_MIME_TYPE,
  checkRecordingClaim,
  createHostReceipt,
  decodeSignedStatement,
  encodeSignedStatement,
  statementAddress,
  statementBytes,
  verifyStatement,
  type ClaimVerification,
  type HostReceipt,
  type RecordingClaim,
  type Signed,
} from '@tapes-monorepo/provenance'
import type { BlobStore } from './blobStore'

/**
 * Checks the claim that came with an upload. If it holds, signs a host receipt
 * for it and stores both statements in the blob store, next to the audio.
 * Shared by the `/blobs` upload route and the electron recorder's file ingest.
 *
 * A claim the host has already receipted gets that same receipt back. A retried
 * upload then keeps the first arrival time, and adds no new objects.
 *
 * A failed check never fails the upload. The audio is kept and reported as
 * unverified. Rejecting it would lose the take, and a hash mismatch would fail
 * the same way on every retry.
 *
 * Do not import `electron` here. The sync server uses this module, and it
 * stays testable in a plain node process.
 */

type ClaimIngestOptions = {
  /** The host's key for signing receipts. Without it, none are issued. */
  loadSigningKey?: () => Promise<CryptoKeyPair>
  /** Where verified statements are kept, owned by the recording's document. */
  store: BlobStore
  docUrl: string
}

type ClaimIngestResult = {
  claim: ClaimVerification
  /**
   * Store hashes of the signed claim and receipt, for the recording's
   * `attestations` list. Empty unless the claim verified.
   */
  attestations: string[]
}

export async function verifyClaimOnIngest(
  encodedClaim: string | undefined,
  received: { hash: string; size: number },
  options: ClaimIngestOptions,
): Promise<ClaimIngestResult> {
  const { claim, statements } = await verifyClaim(
    encodedClaim,
    received,
    options,
  )
  const [claimHash, receiptHash] = await storeStatements(
    statements,
    options.store,
    options.docUrl,
  )
  if (claimHash && receiptHash) {
    try {
      await options.store.setReceiptFor(claimHash, receiptHash)
    } catch (error) {
      // A retry then signs a second receipt. Not worth failing the upload
      // over.
      console.warn('Could not index a host receipt:', error)
    }
  }
  return {
    claim,
    attestations: [claimHash, receiptHash].filter(
      (hash): hash is string => hash !== undefined,
    ),
  }
}

async function verifyClaim(
  encodedClaim: string | undefined,
  received: { hash: string; size: number },
  { loadSigningKey, store }: ClaimIngestOptions,
): Promise<{ claim: ClaimVerification; statements: Signed<unknown>[] }> {
  // Read the clock before any async work, so the receipt says when the bytes
  // arrived rather than when signing finished.
  const receivedAt = new Date()
  if (encodedClaim === undefined) {
    return { claim: { status: 'unsigned' }, statements: [] }
  }

  const signed = decodeSignedStatement(encodedClaim)
  const check = signed
    ? await checkRecordingClaim(signed, received)
    : ({ ok: false, problem: 'malformed' } as const)
  if (!check.ok) {
    console.warn(
      `Recording ${received.hash} stored with an unverified claim: ` +
        check.problem,
    )
    // Not stored. A statement that does not verify is evidence of nothing.
    return {
      claim: { status: 'unverified', problem: check.problem },
      statements: [],
    }
  }

  // The claim stands on its own without a receipt, so a missing host key
  // leaves it verified but uncountersigned.
  if (!loadSigningKey) {
    return { claim: { status: 'verified' }, statements: [check.claim] }
  }
  try {
    const hostKey = await loadSigningKey()
    const receipt =
      (await findReceipt(check.claim, hostKey, store)) ??
      (await createHostReceipt(check.claim, hostKey, receivedAt))
    return {
      claim: { status: 'verified', receipt: encodeSignedStatement(receipt) },
      statements: [check.claim, receipt],
    }
  } catch (error) {
    console.warn(
      'Verified a recording claim but could not sign a receipt:',
      error,
    )
    return { claim: { status: 'verified' }, statements: [check.claim] }
  }
}

/**
 * The receipt this host already signed for the claim, if it is still in the
 * store. Storing it again adds the new document as an owner.
 */
async function findReceipt(
  claim: Signed<RecordingClaim>,
  hostKey: CryptoKeyPair,
  store: BlobStore,
): Promise<Signed<HostReceipt> | undefined> {
  const claimHash = await statementAddress(claim)
  const receiptHash = await store.receiptFor(claimHash)
  if (!receiptHash || !(await store.has(receiptHash))) {
    return undefined
  }
  try {
    const stored = JSON.parse(
      (await buffer(store.read(receiptHash))).toString('utf-8'),
    ) as Signed<Partial<HostReceipt>>
    // Checked against this host's current key, so a receipt from another
    // host, or from a key this host no longer holds, is never reused.
    const isOwnReceipt =
      stored.payload?.type === HOST_RECEIPT_TYPE &&
      stored.payload.claim === claimHash &&
      (await verifyStatement(stored, hostKey.publicKey))
    return isOwnReceipt ? (stored as Signed<HostReceipt>) : undefined
  } catch (error) {
    console.warn(`Could not reuse the stored receipt ${receiptHash}:`, error)
    return undefined
  }
}

/**
 * Stores each statement as its canonical JSON, so its store hash is its
 * statement address. Each gets a ref from the recording's document, the same
 * as the audio, and is released with it.
 *
 * Returns one entry per statement, undefined where storing failed.
 */
async function storeStatements(
  statements: Signed<unknown>[],
  store: BlobStore,
  docUrl: string,
): Promise<(string | undefined)[]> {
  const hashes: (string | undefined)[] = []
  for (const statement of statements) {
    try {
      const { meta } = await store.ingestStream(
        Readable.from([Buffer.from(statementBytes(statement))]),
        { mimeType: STATEMENT_MIME_TYPE, ext: '.json', docUrl },
      )
      hashes.push(meta.hash)
    } catch (error) {
      // The audio is already stored. Losing an attestation is better than
      // failing the upload over it.
      console.warn('Could not store a signed statement:', error)
      hashes.push(undefined)
    }
  }
  return hashes
}
