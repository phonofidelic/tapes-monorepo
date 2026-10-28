import type { AutomergeUrl, Repo } from '@automerge/automerge-repo'
import {
  decodeSignedStatement,
  STATEMENT_MIME_TYPE,
  statementAddress,
  statementBytes,
  type RevocationReason,
} from '@tapes-monorepo/provenance'
import { BlobRequestError, uploadBlob, type BlobEndpoint } from './blobClient'
import type { AppContextValue } from './context/AppContext'
import { signDeviceRevocation } from './personKey'
import type { Recording, RootDocument } from './types'

/**
 * Withdraws trust in one of this person's device keys, for a lost or stolen
 * phone. The person key signs the revocation in the worker. This module puts
 * it where readers will find it.
 *
 * A revocation is about a device, not a take, so it goes on every recording
 * whose statements name the certificate or vouch being withdrawn. It is
 * uploaded under each of those recordings, so a host keeps it as long as it
 * keeps them. A recording is only listed once a host has the bytes, since a
 * statement no host can serve reads as "can't check right now".
 */

/** As in `sessionDelivery.ts`: `find` can stay pending forever. */
const DEFAULT_FIND_TIMEOUT_MS = 5_000

/** The device key to stop trusting, and the statement that vouched for it. */
export type RevokedDevice = {
  deviceKey: string
  /** Address of the certificate or vouch to withdraw. */
  deviceLink: string
  reason: RevocationReason
}

export type RevocationResult = {
  /** The revocation's own statement address. */
  address: string
  /** The recordings that now list it. */
  listedOn: AutomergeUrl[]
}

export async function revokeDevice(
  appContext: AppContextValue,
  repo: Repo,
  details: {
    endpoints: readonly BlobEndpoint[]
    /** The root document whose recordings are searched. */
    docUrl: AutomergeUrl
    device: RevokedDevice
  },
  { findTimeoutMs = DEFAULT_FIND_TIMEOUT_MS } = {},
): Promise<RevocationResult> {
  const encoded = await signDeviceRevocation(appContext, details.device)
  const signed = decodeSignedStatement(encoded)
  if (!signed) {
    throw new Error('The signed revocation could not be read back')
  }
  const bytes = statementBytes(signed)
  const address = await statementAddress(signed)

  const find = <T>(url: AutomergeUrl) =>
    repo.find<T>(url, { signal: AbortSignal.timeout(findTimeoutMs) })
  const root = (await find<RootDocument>(details.docUrl)).doc()
  const listedOn: AutomergeUrl[] = []

  for (const url of root?.recordings ?? []) {
    // Legacy root documents can hold junk entries, as `blobGc.ts` notes.
    if (typeof url !== 'string') {
      continue
    }
    let handle
    try {
      handle = await find<Recording>(url)
    } catch (error) {
      console.warn(`Could not open recording ${url} to revoke a device:`, error)
      continue
    }
    const statements = handle.doc()?.statements
    if (
      !Array.isArray(statements) ||
      !statements.includes(details.device.deviceLink)
    ) {
      continue
    }
    if (statements.includes(address)) {
      listedOn.push(url)
      continue
    }
    if (!(await copyRevocation(details.endpoints, bytes, url))) {
      continue
    }
    handle.change((doc) => {
      doc.statements?.push(address)
    })
    listedOn.push(url)
  }
  return { address, listedOn }
}

/** Whether at least one host took the revocation for this recording. */
async function copyRevocation(
  endpoints: readonly BlobEndpoint[],
  bytes: Uint8Array<ArrayBuffer>,
  docUrl: AutomergeUrl,
): Promise<boolean> {
  const stored = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        await uploadBlob(endpoint, new Blob([bytes]), {
          mimeType: STATEMENT_MIME_TYPE,
          docUrl,
        })
        return true
      } catch (error) {
        // A host that never held the certificate or vouch refuses the
        // revocation. That is the expected answer, not a fault to report.
        if (!(error instanceof BlobRequestError) || error.status !== 422) {
          console.warn('Could not copy a revocation to a host:', error)
        }
        return false
      }
    }),
  )
  return stored.some(Boolean)
}
