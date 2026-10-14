import {
  sha256Hex,
  verifyRecordingStatements,
  type FetchedStatement,
  type RecordingProvenance,
} from '@tapes-monorepo/provenance'
import {
  BlobFetchError,
  fetchBlobFromAny,
  type BlobEndpoint,
} from './blobClient'

/**
 * Fetches the signed statements a recording lists and asks the provenance
 * package what they prove. The checks live there. This module only fetches.
 *
 * A statement no host could serve is passed on as not fetched, which the
 * verifier reports as "can't check right now". Bytes that do not hash to
 * their address are passed on too, so the verifier can fail them.
 */

/**
 * Statement bytes that hashed to their address, by address. A statement never
 * changes, so one fetched is never fetched again. Statements are a few hundred
 * bytes, so the cache is not bounded.
 */
/** The parts of a recording its provenance depends on. */
export type ProvenanceInput = {
  blob?: { hash: string; size: number }
  statements?: readonly string[]
}

const verifiedBytes = new Map<string, Uint8Array<ArrayBuffer>>()

export function clearStatementCache(): void {
  verifiedBytes.clear()
}

async function fetchStatement(
  endpoints: readonly BlobEndpoint[],
  hash: string,
  signal: AbortSignal | undefined,
): Promise<FetchedStatement> {
  const cached = verifiedBytes.get(hash)
  if (cached) {
    return { hash, bytes: cached }
  }
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const { blob } = await fetchBlobFromAny(endpoints, hash, { signal })
    bytes = new Uint8Array(await blob.arrayBuffer())
  } catch (error) {
    // Unreachable, unpaired, or a 404 from every host. None of these says the
    // statement is bad, only that it cannot be checked yet.
    if (error instanceof BlobFetchError) {
      return { hash, bytes: null }
    }
    throw error
  }
  if ((await sha256Hex(bytes)) === hash) {
    verifiedBytes.set(hash, bytes)
  }
  return { hash, bytes }
}

/**
 * What a recording's statements prove about it. A recording with no blob
 * descriptor is unverified: there is no audio for a claim to bind to.
 *
 * Rejects only when `signal` aborts.
 */
export async function checkRecordingProvenance(
  endpoints: readonly BlobEndpoint[],
  recording: ProvenanceInput,
  options: { signal?: AbortSignal } = {},
): Promise<RecordingProvenance> {
  const { blob, statements = [] } = recording
  if (!blob || statements.length === 0) {
    return { state: 'unverified' }
  }
  const fetched = await Promise.all(
    [...new Set(statements)].map((hash) =>
      fetchStatement(endpoints, hash, options.signal),
    ),
  )
  return verifyRecordingStatements(blob, fetched)
}
