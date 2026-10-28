import { Readable } from 'stream'
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo/slim'
import { STATEMENT_MIME_TYPE } from '@tapes-monorepo/provenance'
import type { Recording, RootDocument } from '@tapes-monorepo/core'
import type { BlobStore } from './blobStore'

/**
 * Lists a revocation the host signed on the recordings it covers. A recording
 * is covered when its `statements` list names the vouch being withdrawn.
 *
 * A revocation is about a device, not a take, so it goes on every one of them.
 * The bytes are stored under each recording as well, so this host keeps the
 * revocation as long as it keeps them. This is the host's own copy of what
 * `deviceRevocation.ts` in core does for a person's revocation.
 *
 * Do not import `electron` here, so this stays testable in a plain node
 * process.
 */

/** As in `sessionDelivery.ts`: `find` can stay pending forever. */
const DEFAULT_FIND_TIMEOUT_MS = 5_000

/** Resolves with the URLs of the recordings that now list the revocation. */
export async function listDeviceRevocation(
  repo: Repo,
  store: BlobStore,
  details: {
    docUrl: string
    bytes: Uint8Array
    /** Address of the revocation itself. */
    address: string
    /** Address of the certificate or vouch it withdraws. */
    deviceLink: string
  },
  { findTimeoutMs = DEFAULT_FIND_TIMEOUT_MS } = {},
): Promise<AutomergeUrl[]> {
  const find = <T>(url: AutomergeUrl) =>
    repo.find<T>(url, { signal: AbortSignal.timeout(findTimeoutMs) })

  const root = (await find<RootDocument>(details.docUrl as AutomergeUrl)).doc()
  const listed: AutomergeUrl[] = []
  for (const url of root?.recordings ?? []) {
    // Legacy root documents can hold junk entries, as `blobGc.ts` notes.
    if (typeof url !== 'string') {
      continue
    }
    let handle
    try {
      handle = await find<Recording>(url)
    } catch (error) {
      console.warn(`Could not open recording ${url} to revoke a vouch:`, error)
      continue
    }
    const statements = handle.doc()?.statements
    if (
      !Array.isArray(statements) ||
      !statements.includes(details.deviceLink)
    ) {
      continue
    }
    try {
      await store.ingestStream(Readable.from([Buffer.from(details.bytes)]), {
        mimeType: STATEMENT_MIME_TYPE,
        ext: '.json',
        docUrl: url,
      })
    } catch (error) {
      // A recording the store cannot take the revocation for is left out of
      // the list, so the operator can try it again.
      console.warn(`Could not store a revocation for ${url}:`, error)
      continue
    }
    if (!statements.includes(details.address)) {
      handle.change((doc) => {
        doc.statements?.push(details.address)
      })
    }
    listed.push(url)
  }
  return listed
}
