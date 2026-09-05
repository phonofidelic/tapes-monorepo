import type { AppContextValue } from './context/AppContext'
import type { BlobDescriptor } from './types'
import type { HasBlobResponse, IpcResponse } from './IpcService'
import { callWorker } from './workerClient'

/**
 * The device-local copy of blobs fetched from the host. A guest's storage
 * grows with what it has played, not with the size of the library.
 *
 * Web keeps blobs in an OPFS `blobs/` directory keyed by hash. Electron hands
 * them to its own blob store, which for a host is already where the bytes
 * live. Both are addressed by content hash, so a cached blob is always the
 * right bytes and never needs invalidating.
 */

/** Bytes to keep locally before evicting the least recently played. */
export const DEFAULT_CACHE_BUDGET_BYTES = 500 * 1024 * 1024

const CACHE_INDEX_KEY = 'tapes.blobCache'

type CacheEntry = { size: number; lastPlayedAt: number }
type CacheIndex = Record<string, CacheEntry>

function readIndex(storage: Storage): CacheIndex {
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_INDEX_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as CacheIndex)
      : {}
  } catch {
    return {}
  }
}

function writeIndex(storage: Storage, index: CacheIndex) {
  storage.setItem(CACHE_INDEX_KEY, JSON.stringify(index))
}

export function recordCacheHit(hash: string, size: number, storage: Storage) {
  const index = readIndex(storage)
  index[hash] = { size, lastPlayedAt: Date.now() }
  writeIndex(storage, index)
}

export function forgetCacheEntry(hash: string, storage: Storage) {
  const index = readIndex(storage)
  delete index[hash]
  writeIndex(storage, index)
}

/**
 * Least recently played first, skipping anything the user pinned. A pin is a
 * promise that the recording stays playable with the host switched off.
 */
export function selectEvictions(
  storage: Storage,
  pinnedHashes: ReadonlySet<string>,
  budgetBytes = DEFAULT_CACHE_BUDGET_BYTES,
): string[] {
  const index = readIndex(storage)
  const entries = Object.entries(index)
  let total = entries.reduce((sum, [, entry]) => sum + entry.size, 0)
  if (total <= budgetBytes) {
    return []
  }

  const evictable = entries
    .filter(([hash]) => !pinnedHashes.has(hash))
    .sort(([, a], [, b]) => a.lastPlayedAt - b.lastPlayedAt)

  const evicted: string[] = []
  for (const [hash, entry] of evictable) {
    if (total <= budgetBytes) {
      break
    }
    evicted.push(hash)
    total -= entry.size
  }
  return evicted
}

export async function hasCachedBlob(
  appContext: AppContextValue,
  hash: string,
): Promise<boolean> {
  if (appContext.type === 'web-client') {
    const result = await callWorker<{ present: boolean }>(
      appContext.worker,
      'blob:has',
      { hash },
    )
    return result.present
  }
  const response = await appContext.ipc.send<HasBlobResponse>('blob:has', {
    data: { hash },
  })
  return response.success && response.data.present
}

/**
 * Resolves a cached blob to something an `<audio>` element can play. On web
 * this is an object URL, which the caller must revoke when done. On electron
 * it is a `tapes-blob://` url that the protocol handler serves from the store.
 */
export async function cachedBlobSource(
  appContext: AppContextValue,
  descriptor: BlobDescriptor,
): Promise<{ src: string; revoke: boolean } | null> {
  if (appContext.type === 'electron-client') {
    return (await hasCachedBlob(appContext, descriptor.hash))
      ? { src: `tapes-blob://${descriptor.hash}`, revoke: false }
      : null
  }

  try {
    const { blob } = await callWorker<{ blob: Blob }>(
      appContext.worker,
      'blob:get',
      { hash: descriptor.hash, mimeType: descriptor.mimeType },
    )
    return { src: URL.createObjectURL(blob), revoke: true }
  } catch {
    return null
  }
}

export async function cacheBlob(
  appContext: AppContextValue,
  descriptor: BlobDescriptor,
  blob: Blob,
  docUrl: string,
): Promise<void> {
  if (appContext.type === 'web-client') {
    const bytes = await blob.arrayBuffer()
    await callWorker(
      appContext.worker,
      'blob:put',
      { hash: descriptor.hash, bytes },
      { transfer: [bytes] },
    )
    return
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  await appContext.ipc.send<IpcResponse>('blob:cache-put', {
    data: {
      hash: descriptor.hash,
      mimeType: descriptor.mimeType,
      docUrl,
      bytes,
    },
  })
}

export async function evictCachedBlob(
  appContext: AppContextValue,
  hash: string,
): Promise<void> {
  if (appContext.type === 'web-client') {
    await callWorker(appContext.worker, 'blob:delete', { hash })
  }
  // Electron's cache is the host's own blob store; dropping bytes there is
  // driven by document refcounts, not by cache pressure.
}
