import { existsSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Repo,
  type AutomergeUrl,
  type NetworkAdapterInterface,
  type StorageAdapterInterface,
} from '@automerge/automerge-repo'
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs'
import type { RecordingRepoState } from '@tapes-monorepo/core'
import { startSyncServer, stopSyncServer } from './syncServer'
import { bootstrapRendererRepo, type SyncServerUrls } from './rendererRepo'

/**
 * Exercises the renderer's bootstrap against the real embedded sync server, so
 * the paths that would otherwise only run on a user's machine — in particular
 * the handoff of a pre-TAP-69 library the server has never seen — run in CI.
 * `createStorage` stands in for IndexedDB (unavailable under node) with the same
 * NodeFS adapter the server uses; the bootstrap only cares that it persists.
 */

let serverStoragePath: string | undefined
let rendererStoragePath: string | undefined
const openRepos: Repo[] = []

afterEach(async () => {
  await Promise.all(
    openRepos.splice(0).map(async (repo) => {
      // A socket still mid-handshake throws on close; irrelevant to the test.
      try {
        await repo.shutdown()
      } catch {
        /* empty */
      }
    }),
  )
  await stopSyncServer()
  for (const dir of [serverStoragePath, rendererStoragePath]) {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
  serverStoragePath = undefined
  rendererStoragePath = undefined
})

async function serverStorage() {
  serverStoragePath ??= await mkdtemp(path.join(tmpdir(), 'tapes-server-'))
  return serverStoragePath
}

async function rendererStorage(): Promise<StorageAdapterInterface> {
  rendererStoragePath ??= await mkdtemp(path.join(tmpdir(), 'tapes-renderer-'))
  return new NodeFSStorageAdapter(rendererStoragePath)
}

/** The embedded sync server, on an OS-assigned port so suites never collide. */
async function startServer() {
  const info = await startSyncServer({
    storagePath: await serverStorage(),
    host: '127.0.0.1',
    port: 0,
    peerId: `test-host-${Math.random()}`,
  })

  // The server's storage id resolves asynchronously, and its peer metadata is
  // pending until it does. A client that joins inside that window has its join
  // dropped and never peers. In the app this cannot happen — main starts the
  // server at `app.ready` and the renderer connects later, after an IPC
  // round-trip — but a test that connects in the same tick would hit it every
  // time, so mirror the real ordering.
  await new Promise((resolve) => setTimeout(resolve, 500))

  return info
}

// The renderer builds BrowserWebSocketClientAdapters; under node the ws-backed
// adapter speaks the same protocol to the same server.
function createNetwork(urls: SyncServerUrls): NetworkAdapterInterface[] {
  return [urls.localUrl, urls.remoteUrl]
    .filter((url): url is string => Boolean(url))
    .map((url) => new WebSocketClientAdapter(url))
}

async function bootstrap(
  storedUrl: AutomergeUrl | null,
  urls: SyncServerUrls,
  createStorage: () => StorageAdapterInterface,
) {
  const result = await bootstrapRendererRepo({
    storedUrl,
    urls,
    createStorage,
    createNetwork,
    // Keep failures fast: these repos are either connected or deliberately not.
    findTimeoutMs: 2_000,
  })
  if (result.status === 'ready') {
    openRepos.push(result.repo)
  }
  return result
}

/** Writes a library into a storage adapter, as a previous session would have. */
async function seedLibrary(storage: StorageAdapterInterface) {
  const repo = new Repo({ storage })
  const handle = repo.create<RecordingRepoState>({ recordings: [] })
  handle.change((doc) => {
    doc.recordings.push('automerge:seeded-recording' as AutomergeUrl)
  })
  await repo.flush()
  await repo.shutdown()
  return handle.url
}

/**
 * Waits for the sync server to have written a document to disk. Syncing is
 * asynchronous, and the layout is NodeFSStorageAdapter's: the first two
 * characters of the document id name a directory holding the rest.
 */
async function waitForServerToStore(url: AutomergeUrl) {
  const documentId = url.replace('automerge:', '')
  const docPath = path.join(
    await serverStorage(),
    documentId.slice(0, 2),
    documentId.slice(2),
  )

  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(docPath)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Sync server never stored ${url}`)
}

describe('bootstrapRendererRepo against the embedded sync server', () => {
  const noRendererStorage = () => {
    throw new Error('renderer storage should not be needed')
  }

  it('finds a library the server holds, without any renderer storage', async () => {
    const url = await seedLibrary(
      new NodeFSStorageAdapter(await serverStorage()),
    )
    const info = await startServer()

    const result = await bootstrap(
      url,
      { localUrl: info.url },
      noRendererStorage,
    )

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    // The server's share policy never announces; this works only because it
    // still answers for documents a peer explicitly requests.
    expect(result.repo.storageSubsystem).toBeUndefined()
    expect(result.handle.url).toBe(url)
  })

  it('creates a library when none is stored, and the server persists it', async () => {
    const info = await startServer()

    const result = await bootstrap(
      null,
      { localUrl: info.url },
      noRendererStorage,
    )

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.createdUrl).toBe(result.handle.url)

    // The point of TAP-69: the renderer holds no storage, so this is only
    // durable if the host wrote it to its own filesystem.
    await waitForServerToStore(result.handle.url)
  })

  // The pre-TAP-69 migration: the library exists only in the renderer's own
  // store, and the server has never seen it.
  it('falls back to renderer storage and hands the library to the server', async () => {
    const storage = await rendererStorage()
    const url = await seedLibrary(storage)
    const info = await startServer()

    const result = await bootstrap(url, { localUrl: info.url }, () => storage)

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    // Fell back to the store-backed repo rather than inventing a new document.
    expect(result.repo.storageSubsystem).toBeDefined()
    expect(result.handle.url).toBe(url)

    // The handoff itself: the server received the library and wrote it to disk.
    await waitForServerToStore(url)

    // And so the next launch needs no renderer storage at all. Restarting the
    // server proves the document came off disk rather than out of its memory.
    await stopSyncServer()
    const restarted = await startServer()
    const nextLaunch = await bootstrap(
      url,
      { localUrl: restarted.url },
      noRendererStorage,
    )

    expect(nextLaunch.status).toBe('ready')
    if (nextLaunch.status !== 'ready') return
    expect(nextLaunch.repo.storageSubsystem).toBeUndefined()
    expect(nextLaunch.handle.url).toBe(url)
  })

  it('reports unavailable when neither the server nor renderer storage has it', async () => {
    const info = await startServer()
    const storage = await rendererStorage()

    const result = await bootstrap(
      'automerge:2j9knpCseyhnK8izDmLpGP5NdMdt' as AutomergeUrl,
      { localUrl: info.url },
      () => storage,
    )

    expect(result.status).toBe('unavailable')
  })

  it('uses renderer storage when no embedded server is running', async () => {
    const storage = await rendererStorage()
    const url = await seedLibrary(storage)

    const result = await bootstrap(url, {}, () => storage)

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.repo.storageSubsystem).toBeDefined()
    expect(result.handle.url).toBe(url)
  })
})
