import { Readable } from 'stream'
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
import { readStoredStatement } from './statementUpload'

/**
 * Checks the claim that came with an upload. If it holds, countersigns it with
 * a host receipt and stores both statements in the blob store, next to the
 * audio. Shared by the `/blobs` upload route and the electron recorder's file
 * ingest.
 *
 * A failed check never fails the upload. The audio is kept and reported as
 * unverified. Rejecting it would lose the take, and a hash mismatch would fail
 * the same way on every retry.
 *
 * A claim gets one receipt per host. A repeat upload of the same claim gets the
 * receipt signed the first time, so its time stays the first arrival.
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
   * `statements` list. Empty unless the claim verified.
   */
  statements: string[]
}

// The host is a single process, so an in-memory queue per claim is enough to
// stop two concurrent uploads of one claim from each signing a receipt.
const claimLocks = new Map<string, Promise<unknown>>()

function withClaimLock<T>(claimHash: string, fn: () => Promise<T>): Promise<T> {
  const previous = claimLocks.get(claimHash) ?? Promise.resolve()
  const run = previous.then(fn)
  const settled = run.catch(() => undefined)
  claimLocks.set(claimHash, settled)
  void settled.then(() => {
    if (claimLocks.get(claimHash) === settled) {
      claimLocks.delete(claimHash)
    }
  })
  return run
}

export async function verifyClaimOnIngest(
  encodedClaim: string | undefined,
  received: { hash: string; size: number },
  options: ClaimIngestOptions,
): Promise<ClaimIngestResult> {
  // Read the clock before any async work, so a new receipt says when the bytes
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

  const claimHash = await statementAddress(check.claim)
  return withClaimLock(claimHash, async () => {
    const receipt = await receiptFor(
      check.claim,
      claimHash,
      receivedAt,
      options,
    )
    // The claim stands on its own without a receipt, so a missing host key
    // leaves it verified but uncountersigned.
    if (!receipt) {
      return {
        claim: { status: 'verified' },
        statements: await storeStatements(
          [check.claim],
          options.store,
          options.docUrl,
        ),
      }
    }

    // Storing a reused receipt again dedupes it and adds this document as an
    // owner, so it is kept as long as any recording that lists it.
    const statements = await storeStatements(
      [check.claim, receipt.signed],
      options.store,
      options.docUrl,
    )
    if (receipt.isNew) {
      await indexReceipt(options.store, claimHash, receipt.signed, statements)
    }
    return {
      claim: {
        status: 'verified',
        receipt: encodeSignedStatement(receipt.signed),
      },
      statements,
    }
  })
}

/** The receipt this host already signed for the claim, or a new one. */
async function receiptFor(
  claim: Signed<RecordingClaim>,
  claimHash: string,
  receivedAt: Date,
  { loadSigningKey, store }: ClaimIngestOptions,
): Promise<{ signed: Signed<HostReceipt>; isNew: boolean } | null> {
  if (!loadSigningKey) {
    return null
  }
  try {
    const keyPair = await loadSigningKey()
    const existing = await readOwnReceipt(store, claimHash, keyPair)
    if (existing) {
      return { signed: existing, isNew: false }
    }
    return {
      signed: await createHostReceipt(claim, keyPair, receivedAt),
      isNew: true,
    }
  } catch (error) {
    console.warn(
      'Verified a recording claim but could not sign a receipt:',
      error,
    )
    return null
  }
}

/**
 * The indexed receipt for a claim, if it is still stored and verifies against
 * the host's current key. After a key reset the host signs a new one.
 */
async function readOwnReceipt(
  store: BlobStore,
  claimHash: string,
  keyPair: CryptoKeyPair,
): Promise<Signed<HostReceipt> | null> {
  const hash = await store.findReceipt(claimHash)
  const stored = hash
    ? ((await readStoredStatement(store, hash)) as Signed<HostReceipt> | null)
    : null
  const matches =
    stored?.payload?.type === HOST_RECEIPT_TYPE &&
    stored.payload.claim === claimHash &&
    (await verifyStatement(stored, keyPair.publicKey))
  return matches ? stored : null
}

/** Records a new receipt in the index, once it is safely in the store. */
async function indexReceipt(
  store: BlobStore,
  claimHash: string,
  receipt: Signed<HostReceipt>,
  stored: string[],
): Promise<void> {
  const receiptHash = await statementAddress(receipt)
  if (!stored.includes(receiptHash)) {
    return
  }
  try {
    await store.recordReceipt(claimHash, receiptHash)
  } catch (error) {
    // The receipt is stored and listed. A retry would only sign another one.
    console.warn('Could not index a host receipt:', error)
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
      // The audio is already stored. Losing a statement is better than
      // failing the upload over it.
      console.warn('Could not store a signed statement:', error)
    }
  }
  return hashes
}
