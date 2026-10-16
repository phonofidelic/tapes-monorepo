import type { AutomergeUrl, Repo } from '@automerge/automerge-repo/slim'
import type { Recording, RootDocument } from '@tapes-monorepo/core'

/**
 * Lists a signed session record on the recordings it covers. A recording is
 * covered when its `statements` list names one of the record's claims.
 *
 * The record is signed after the session's uploads, so the recorder that
 * listed the claim cannot list the record too. The host adds it here instead.
 *
 * Do not import `electron` here, so this stays testable in a plain node
 * process.
 */

/** As in `blobGc.ts`: `find` can stay pending forever without a deadline. */
const DEFAULT_FIND_TIMEOUT_MS = 5_000

/** Resolves with the URLs of the recordings that now list the record. */
export async function listSessionRecord(
  repo: Repo,
  details: { docUrl: string; recordHash: string; claims: readonly string[] },
  { findTimeoutMs = DEFAULT_FIND_TIMEOUT_MS } = {},
): Promise<AutomergeUrl[]> {
  const claims = new Set(details.claims)
  if (claims.size === 0) {
    return []
  }
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
      console.warn(
        `Could not open recording ${url} for a session record:`,
        error,
      )
      continue
    }
    const statements = handle.doc()?.statements
    if (!Array.isArray(statements) || !statements.some((h) => claims.has(h))) {
      continue
    }
    if (!statements.includes(details.recordHash)) {
      handle.change((doc) => {
        doc.statements?.push(details.recordHash)
      })
    }
    listed.push(url)
  }
  return listed
}
