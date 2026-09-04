import path from 'path'
import { Readable } from 'stream'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Repo, type AutomergeUrl } from '@automerge/automerge-repo'
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs'
import type { RecordingData, RecordingRepoState } from '@tapes-monorepo/core'
import { collectOrphanedBlobs, DEFAULT_GRACE_MS } from './blobGc'
import { createBlobStore } from './blobStore'

/**
 * The GC composes a repo and a blob store, so these run both for real: a
 * `NodeFSStorageAdapter` repo on a temp directory, and a real store on
 * another. No sync server — the walk only ever reads documents this host
 * already has on disk, and leaving the network out keeps the suite
 * deterministic.
 */

let storagePath: string
let blobRoot: string
let workspace: string
const openRepos: Repo[] = []

beforeEach(async () => {
  storagePath = await mkdtemp(path.join(tmpdir(), 'tapes-gc-storage-'))
  blobRoot = await mkdtemp(path.join(tmpdir(), 'tapes-gc-blobs-'))
  workspace = await mkdtemp(path.join(tmpdir(), 'tapes-gc-recordings-'))
})

afterEach(async () => {
  await Promise.all(
    openRepos.splice(0).map(async (repo) => {
      try {
        await repo.shutdown()
      } catch {
        /* empty */
      }
    }),
  )
  await Promise.all(
    [storagePath, blobRoot, workspace].map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  )
})

function openRepo() {
  const repo = new Repo({ storage: new NodeFSStorageAdapter(storagePath) })
  openRepos.push(repo)
  return repo
}

const store = () => createBlobStore(blobRoot)

/** Ages every object past the grace period without touching the clock. */
const afterGrace = () => Date.now() + DEFAULT_GRACE_MS + 60_000

async function ingest(contents: string, docUrl: string) {
  const { meta } = await store().ingestStream(Readable.from([contents]), {
    mimeType: 'audio/mp4',
    docUrl,
  })
  return meta.hash
}

/**
 * Seeds a library and returns its root url. Written through a repo that is
 * then shut down, so the GC reads it back from disk the way the host would.
 */
async function seedLibrary(
  recordings: { contents: string; hash?: string }[],
): Promise<{ root: AutomergeUrl; hashes: string[] }> {
  const repo = openRepo()
  const root = repo.create<RecordingRepoState>({ recordings: [] })
  const hashes: string[] = []

  for (const [index, recording] of recordings.entries()) {
    const doc = repo.create<RecordingData>({
      url: '' as AutomergeUrl,
      filename: `recording-${index}.mp4`,
      filepath: path.join(workspace, `recording-${index}.mp4`),
      name: `Recording ${index}`,
      duration: 1,
      id: `recording-${index}`,
    })
    const hash =
      recording.hash ?? (await ingest(recording.contents, doc.url as string))
    hashes.push(hash)
    doc.change((data) => {
      data.url = doc.url
      data.blob = {
        hash,
        size: recording.contents.length,
        mimeType: 'audio/mp4',
        ext: '.mp4',
      }
    })
    root.change((data) => {
      data.recordings.push(doc.url)
    })
  }

  await repo.flush()
  return { root: root.url, hashes }
}

describe('collectOrphanedBlobs', () => {
  it('keeps a blob its recording still references', async () => {
    const { root, hashes } = await seedLibrary([{ contents: 'kept audio' }])

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root],
      now: afterGrace(),
    })

    expect(result.abortedReason).toBeUndefined()
    expect(result.live).toBe(1)
    expect(result.swept).toEqual([])
    expect(await store().has(hashes[0])).toBe(true)
  })

  it('sweeps a blob whose recording left the library', async () => {
    const { root, hashes } = await seedLibrary([
      { contents: 'kept audio' },
      { contents: 'deleted audio' },
    ])

    // A peer deletes the second recording: the url leaves `recordings`, but
    // nothing ever tells this host to release the ref.
    const editing = openRepo()
    const handle = await editing.find<RecordingRepoState>(root)
    handle.change((doc) => {
      doc.recordings.splice(1, 1)
    })
    await editing.flush()

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root],
      now: afterGrace(),
    })

    expect(result.swept).toEqual([hashes[1]])
    expect(result.reclaimedBytes).toBe('deleted audio'.length)
    expect(await store().has(hashes[0])).toBe(true)
    expect(await store().has(hashes[1])).toBe(false)
  })

  it('sweeps bytes written before a crash took out the ref record', async () => {
    const { root, hashes } = await seedLibrary([{ contents: 'kept audio' }])
    // No ref file, no meta, no document: exactly what a kill between the
    // object write and `addRef` leaves behind.
    const orphan = await ingest('crash orphan', 'automerge:never-recorded')
    await rm(path.join(blobRoot, 'refs'), { recursive: true, force: true })

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root],
      now: afterGrace(),
    })

    expect(result.swept).toEqual([orphan])
    expect(await store().has(hashes[0])).toBe(true)
  })

  it('leaves an unreferenced object alone inside the grace period', async () => {
    const { root } = await seedLibrary([{ contents: 'kept audio' }])
    // An upload that arrived before its document did. `blobUpload.ts` queues
    // these with a docUrl and no hash, so the mark phase cannot see them.
    const inFlight = await ingest('just uploaded', 'automerge:not-synced-yet')

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root],
      now: Date.now(),
    })

    expect(result.swept).toEqual([])
    expect(result.skippedYoung).toBe(1)
    expect(await store().has(inFlight)).toBe(true)
  })

  it('reclaims nothing when the user still holds the file', async () => {
    const { root } = await seedLibrary([{ contents: 'kept audio' }])
    const filepath = path.join(workspace, 'orphan.wav')
    await writeFile(filepath, 'hardlinked orphan')
    const { meta } = await store().ingestFile(filepath, {
      docUrl: 'automerge:gone',
    })

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root],
      now: afterGrace(),
    })

    expect(result.swept).toEqual([meta.hash])
    expect(result.stillHardlinked).toBe(1)
    // Dropping the store's link freed nothing, and the user's recording is
    // untouched.
    expect(result.reclaimedBytes).toBe(0)
    expect(await readFile(filepath, 'utf-8')).toBe('hardlinked orphan')
  })

  it('keeps another library’s blobs when only one root is announced', async () => {
    const mine = await seedLibrary([{ contents: 'my audio' }])
    // A guest that arrived with its own library (`?am=`) and uploaded to this
    // host. Its blobs are not reachable from the announced root at all.
    const guest = await seedLibrary([{ contents: 'guest audio' }])

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [mine.root],
      now: afterGrace(),
    })

    expect(result.swept).toEqual([])
    expect(result.roots).toHaveLength(2)
    expect(await store().has(guest.hashes[0])).toBe(true)
  })

  it('sweeps nothing when a recording will not resolve', async () => {
    const { root, hashes } = await seedLibrary([{ contents: 'kept audio' }])
    // A well-formed recording url that no peer can supply — created in a repo
    // whose storage this host never sees, so `find` times out rather than
    // failing to parse. Treating that as "references nothing" would delete
    // live audio.
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'tapes-gc-absent-'))
    const absentRepo = new Repo({
      storage: new NodeFSStorageAdapter(elsewhere),
    })
    const absent = absentRepo.create<RecordingData>({} as RecordingData).url
    await absentRepo.shutdown()
    await rm(elsewhere, { recursive: true, force: true })

    const editing = openRepo()
    const handle = await editing.find<RecordingRepoState>(root)
    handle.change((doc) => {
      doc.recordings.push(absent)
    })
    await editing.flush()

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root],
      findTimeoutMs: 250,
      now: afterGrace(),
    })

    expect(result.abortedReason).toMatch(/Could not resolve recording/)
    expect(result.swept).toEqual([])
    expect(await store().has(hashes[0])).toBe(true)
  })

  it('refuses to sweep a store it found no library for', async () => {
    const orphan = await ingest('no library at all', 'automerge:gone')

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      now: afterGrace(),
    })

    expect(result.abortedReason).toMatch(/No library documents found/)
    expect(await store().has(orphan)).toBe(true)
  })

  it('tolerates a legacy library whose recordings predate blob descriptors', async () => {
    const repo = openRepo()
    const root = repo.create<RecordingRepoState>({ recordings: [] })
    const legacy = repo.create<RecordingData>({
      url: '' as AutomergeUrl,
      filename: 'old.wav',
      filepath: path.join(workspace, 'old.wav'),
      name: 'Old',
      duration: 1,
      id: 'old',
      // Bytes inline, the pre-TAP-71 shape: no hash to contribute.
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
    })
    root.change((doc) => {
      doc.recordings.push(legacy.url)
    })
    await repo.flush()

    const result = await collectOrphanedBlobs({
      repo: openRepo(),
      store: store(),
      storagePath,
      seedRoots: [root.url],
      now: afterGrace(),
    })

    expect(result.abortedReason).toBeUndefined()
    expect(result.live).toBe(0)
    expect(result.scanned).toBe(0)
  })
})
