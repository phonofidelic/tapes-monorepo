import path from 'path'
import { readdir } from 'fs/promises'
import type { Repo, AutomergeUrl } from '@automerge/automerge-repo/slim'
import type { RecordingData, RecordingRepoState } from '@tapes-monorepo/core'
import type { BlobStore, StoredObject } from './blobStore'

/**
 * Mark-and-sweep for the blob store.
 *
 * The store reclaims space by refcount, which only works when every owner
 * announces itself. Three things defeat that: a crash between writing the
 * object and writing its ref record, a peer that deletes a recording while
 * offline and never reaches `DELETE /blobs/:hash?doc=`, and uploads abandoned
 * outside `tmp/`. None of those can ever be released, so the only way to find
 * them is to ask the doc graph what is still referenced and unlink the rest.
 *
 * This lives outside `blobStore.ts` on purpose. The store imports nothing from
 * Automerge or Electron — that is what lets the HTTP surface be tested against
 * a real server in a plain node process — so the knowledge of what a recording
 * document looks like is composed in here instead of reaching into it.
 */

/** Objects younger than this are never swept. See `collectOrphanedBlobs`. */
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * The websocket adapter reports itself ready about a second after construction
 * whether or not it ever connected, so an unresolvable document would leave
 * `find` pending forever without a deadline.
 */
const DEFAULT_FIND_TIMEOUT_MS = 5_000

export type BlobGcResult = {
  /** Objects present in the store when the sweep ran. */
  scanned: number
  /** Hashes reachable from a live library. */
  live: number
  swept: string[]
  /** Unreferenced, but inside the grace period. */
  skippedYoung: number
  /**
   * Bytes whose last link was dropped. Objects still hardlinked from the
   * user's recordings folder are excluded — unlinking those frees nothing.
   */
  reclaimedBytes: number
  /** Swept objects the user still holds a copy of. */
  stillHardlinked: number
  roots: AutomergeUrl[]
  /**
   * Set when the mark phase could not be completed. The sweep is abandoned
   * whole rather than run on a partial set — see `collectOrphanedBlobs`.
   */
  abortedReason?: string
}

type Doc = Record<string, unknown>

async function findDoc(
  repo: Repo,
  url: AutomergeUrl,
  timeoutMs: number,
): Promise<Doc | undefined> {
  const handle = await repo.find<Doc>(url, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  return handle.doc()
}

/**
 * Document ids the host has on disk, from `NodeFSStorageAdapter`'s layout: the
 * first two characters of the id name a directory holding the rest. The same
 * layout `rendererRepoBootstrap.test.ts` waits on.
 */
async function storedDocumentUrls(
  storagePath: string,
): Promise<AutomergeUrl[]> {
  const urls: AutomergeUrl[] = []
  let prefixes: string[]
  try {
    prefixes = await readdir(storagePath)
  } catch {
    return urls
  }
  for (const prefix of prefixes) {
    if (prefix.startsWith('.')) {
      continue
    }
    let rests: string[]
    try {
      rests = await readdir(path.join(storagePath, prefix))
    } catch {
      continue
    }
    for (const rest of rests) {
      urls.push(`automerge:${prefix}${rest}` as AutomergeUrl)
    }
  }
  return urls
}

/**
 * A document is a library root when it carries a `recordings` array.
 *
 * Every root on disk counts, not just this device's own: the store is shared
 * across every library this host has served, and a guest can arrive with its
 * own library (`?am=` in `utils.ts`) and upload blobs against it. Sweeping
 * against one library's reachable set would delete another's audio.
 */
function isRootDoc(doc: Doc | undefined): doc is Doc & RecordingRepoState {
  return Array.isArray(doc?.recordings)
}

/**
 * Walks the live doc graph and unlinks objects it cannot reach.
 *
 * Two rules keep this from eating live audio:
 *
 * - **A document that will not resolve abandons the whole sweep.** A partial
 *   mark set is indistinguishable from a smaller library, so "I could not read
 *   this" must never be allowed to read as "nothing references those bytes".
 * - **Objects younger than `graceMs` are left alone.** A recording is uploaded
 *   before — and independently of — its document reaching this host, and a
 *   queued upload carries no hash at all (`blobUpload.ts` holds a `docUrl` and
 *   a filepath), so a just-arrived object is legitimately unreachable for a
 *   while.
 */
export async function collectOrphanedBlobs({
  repo,
  store,
  storagePath,
  seedRoots = [],
  graceMs = DEFAULT_GRACE_MS,
  findTimeoutMs = DEFAULT_FIND_TIMEOUT_MS,
  now = Date.now(),
}: {
  repo: Repo
  store: BlobStore
  /** The sync server's `NodeFSStorageAdapter` directory. */
  storagePath: string
  /** Roots already known, e.g. announced by the renderer. */
  seedRoots?: AutomergeUrl[]
  graceMs?: number
  findTimeoutMs?: number
  now?: number
}): Promise<BlobGcResult> {
  const objects = await store.listObjects()
  const empty = (abortedReason: string): BlobGcResult => ({
    scanned: objects.length,
    live: 0,
    swept: [],
    skippedYoung: 0,
    reclaimedBytes: 0,
    stillHardlinked: 0,
    roots: [],
    abortedReason,
  })

  const candidates = new Set<AutomergeUrl>([
    ...seedRoots,
    ...(await storedDocumentUrls(storagePath)),
  ])

  const roots: AutomergeUrl[] = []
  const recordingUrls = new Set<AutomergeUrl>()
  for (const url of candidates) {
    let doc: Doc | undefined
    try {
      doc = await findDoc(repo, url, findTimeoutMs)
    } catch (error) {
      // A seeded root we cannot read is fatal: it is a library whose contents
      // we would otherwise treat as unreferenced. A document merely found on
      // disk may be any unrelated chunk, so it is not worth aborting over.
      if (seedRoots.includes(url)) {
        return empty(`Could not resolve announced library ${url}: ${error}`)
      }
      continue
    }
    if (!isRootDoc(doc)) {
      continue
    }
    roots.push(url)
    for (const recording of doc.recordings) {
      // Legacy libraries predate the current shape; tolerate junk entries
      // rather than failing the walk, as `Recorder.tsx` already does.
      if (typeof recording === 'string') {
        recordingUrls.add(recording)
      }
    }
  }

  if (roots.length === 0 && objects.length > 0) {
    // Objects but no library at all almost certainly means the graph did not
    // load, not that every recording was deleted. Nothing to mark against.
    return empty('No library documents found; refusing to sweep')
  }

  const live = new Set<string>()
  for (const url of recordingUrls) {
    let doc: Doc | undefined
    try {
      doc = await findDoc(repo, url, findTimeoutMs)
    } catch (error) {
      return empty(`Could not resolve recording ${url}: ${error}`)
    }
    // A recording with no descriptor is normal: local-only, or its upload is
    // still queued. Legacy documents carry their bytes inline and no hash.
    const blob = doc?.blob as RecordingData['blob'] | undefined
    if (blob && typeof blob.hash === 'string') {
      live.add(blob.hash)
    }
  }

  const swept: string[] = []
  let skippedYoung = 0
  let reclaimedBytes = 0
  let stillHardlinked = 0

  const recordReclaimed = (object: StoredObject) => {
    // Dropping the store's link to an object the user still has in their
    // recordings folder frees nothing; only the last link reclaims bytes.
    if (object.nlink > 1) {
      stillHardlinked += 1
      return
    }
    reclaimedBytes += object.size
  }

  for (const object of objects) {
    if (live.has(object.hash)) {
      continue
    }
    if (now - object.ctimeMs < graceMs) {
      skippedYoung += 1
      continue
    }
    if (await store.remove(object.hash)) {
      swept.push(object.hash)
      recordReclaimed(object)
    }
  }

  return {
    scanned: objects.length,
    live: live.size,
    swept,
    skippedYoung,
    reclaimedBytes,
    stillHardlinked,
    roots,
  }
}
