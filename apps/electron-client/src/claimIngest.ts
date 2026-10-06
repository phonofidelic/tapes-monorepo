import { Readable } from 'stream'
import {
  STATEMENT_MIME_TYPE,
  checkRecordingClaim,
  createHostReceipt,
  decodeSignedStatement,
  encodeSignedStatement,
  statementBytes,
  type ClaimVerification,
  type Signed,
} from '@tapes-monorepo/provenance'
import type { BlobStore } from './blobStore'

/**
 * Checks the claim that came with an upload. If it holds, signs a host receipt
 * for it and stores both statements in the blob store, next to the audio.
 * Shared by the `/blobs` upload route and the electron recorder's file ingest.
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
    options.loadSigningKey,
  )
  return {
    claim,
    attestations: await storeStatements(
      statements,
      options.store,
      options.docUrl,
    ),
  }
}

async function verifyClaim(
  encodedClaim: string | undefined,
  received: { hash: string; size: number },
  loadSigningKey: (() => Promise<CryptoKeyPair>) | undefined,
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
    const receipt = await createHostReceipt(
      check.claim,
      await loadSigningKey(),
      receivedAt,
    )
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
 * Stores each statement as its canonical JSON, so its store hash is its
 * statement address. Each gets a ref from the recording's document, the same
 * as the audio, and is released with it.
 */
async function storeStatements(
  statements: Signed<unknown>[],
  store: BlobStore,
  docUrl: string,
): Promise<string[]> {
  const hashes: string[] = []
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
    }
  }
  return hashes
}
