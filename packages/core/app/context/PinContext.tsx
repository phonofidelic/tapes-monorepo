import { createContext, use, useCallback, useMemo, useState } from 'react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { BlobDescriptor } from '@/types'
import {
  fetchBlobFromAny,
  replicateBlob,
  type BlobEndpoint,
} from '@/blobClient'
import {
  cacheBlob,
  cacheStatement,
  evictCachedBlob,
  forgetCacheEntry,
  readCachedStatement,
  recordCacheHit,
} from '@/blobCache'
import type { CachedStatementReader } from '@/recordingProvenance'
import { useAppContext, type AppContextValue } from './AppContext'
import { useBlobEndpoints } from './BlobContext'

/**
 * "Keep offline" pins. Playback caches whatever it fetches, but that only
 * helps for recordings the user has already played. A pin is an explicit
 * promise that a recording stays playable with the host switched off, so it
 * pre-fetches immediately and is exempt from cache eviction. The recording's
 * signed statements are kept with the audio, so its provenance can still be
 * checked offline.
 *
 * Pins are per device. Which recordings this phone keeps is not a fact about
 * the root document, so they must not go in it, where they would sync to
 * every peer.
 */

// Not in the `settings` blob either. That is a flat map of strings that three
// separate readers parse and that is rewritten whole on every setting change.
const PINS_KEY = 'tapes.pins'

type PinRecord = {
  hash: string
  size: number
  pinnedAt: number
  /** Absent on pins made before statements were kept. */
  statements?: string[]
}
type PinMap = Record<string, PinRecord>

export type PinState = 'unpinned' | 'pinning' | 'pinned'

type PinContextValue = {
  pinState: (url: AutomergeUrl) => PinState
  /**
   * Fetches the audio and keeps it. A host that lacks it gets a copy, along
   * with the signed statements listed in `statements`.
   */
  pin: (
    url: AutomergeUrl,
    descriptor: BlobDescriptor,
    statements?: readonly string[],
  ) => Promise<void>
  unpin: (url: AutomergeUrl) => Promise<void>
  /** Audio and statement hashes that eviction must keep. */
  pinnedHashes: ReadonlySet<string>
  /** Reads a pinned statement from this device. Null for anything else. */
  readPinnedStatement: CachedStatementReader
}

const PinContext = createContext<PinContextValue | null>(null)

function readPins(): PinMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINS_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as PinMap)
      : {}
  } catch {
    return {}
  }
}

function writePins(pins: PinMap) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins))
}

function heldHashes(pins: PinMap): Set<string> {
  return new Set(
    Object.values(pins).flatMap((record) => [
      record.hash,
      ...(record.statements ?? []),
    ]),
  )
}

/**
 * Best effort. A statement that cannot be fetched now leaves the pin in place.
 * The recording still plays, and its provenance check asks the hosts instead.
 */
async function keepStatements(
  appContext: AppContextValue,
  endpoints: readonly BlobEndpoint[],
  hashes: readonly string[],
): Promise<void> {
  if (appContext.type !== 'web-client') {
    return
  }
  await Promise.all(
    hashes.map(async (hash) => {
      try {
        const { blob } = await fetchBlobFromAny(endpoints, hash)
        await cacheStatement(
          appContext,
          hash,
          new Uint8Array(await blob.arrayBuffer()),
        )
      } catch (error) {
        console.warn('Could not keep a signed statement offline:', error)
      }
    }),
  )
}

export function PinProvider({ children }: { children: React.ReactNode }) {
  const appContext = useAppContext()
  const endpoints = useBlobEndpoints()
  const [pins, setPins] = useState<PinMap>(readPins)
  const [pinning, setPinning] = useState<ReadonlySet<string>>(() => new Set())

  const pin = useCallback(
    async (
      url: AutomergeUrl,
      descriptor: BlobDescriptor,
      statements: readonly string[] = [],
    ) => {
      if (endpoints.length === 0) {
        return
      }
      setPinning((current) => new Set(current).add(url))
      try {
        const { blob, missingFrom } = await fetchBlobFromAny(
          endpoints,
          descriptor.hash,
        )
        if (missingFrom.length > 0) {
          void replicateBlob(missingFrom, blob, {
            mimeType: descriptor.mimeType,
            docUrl: url,
            expectedHash: descriptor.hash,
            statements: {
              hashes: statements,
              // A host without the audio cannot hold a verified claim on it.
              sources: endpoints.filter(
                (endpoint) => !missingFrom.includes(endpoint),
              ),
            },
          })
        }
        await cacheBlob(appContext, descriptor, blob, url)
        recordCacheHit(descriptor.hash, descriptor.size, localStorage)
        const kept = [...new Set(statements)]
        await keepStatements(appContext, endpoints, kept)

        // Without a persistence grant the browser is free to evict OPFS under
        // storage pressure, including the copy the user asked to keep. Ask the
        // first time anything is pinned.
        if (navigator.storage?.persist) {
          void navigator.storage.persist().catch(() => {})
        }

        setPins((current) => {
          const next = {
            ...current,
            [url]: {
              hash: descriptor.hash,
              size: descriptor.size,
              pinnedAt: Date.now(),
              statements: kept,
            },
          }
          writePins(next)
          return next
        })
      } catch (error) {
        console.error('Failed to keep recording offline:', error)
      } finally {
        setPinning((current) => {
          const next = new Set(current)
          next.delete(url)
          return next
        })
      }
    },
    [appContext, endpoints],
  )

  const unpin = useCallback(
    async (url: AutomergeUrl) => {
      const record = pins[url]
      const remaining = { ...pins }
      delete remaining[url]
      setPins((current) => {
        const next = { ...current }
        delete next[url]
        writePins(next)
        return next
      })
      if (record) {
        // Drop the bytes as well as the promise: an unpinned recording is
        // ordinary cache again, and the user asked for the space back. A
        // session record can be listed by several recordings, so keep any
        // hash another pin still holds.
        const stillHeld = heldHashes(remaining)
        for (const hash of [record.hash, ...(record.statements ?? [])]) {
          if (!stillHeld.has(hash)) {
            await evictCachedBlob(appContext, hash)
          }
        }
        if (!stillHeld.has(record.hash)) {
          forgetCacheEntry(record.hash, localStorage)
        }
      }
    },
    [appContext, pins],
  )

  const pinnedHashes = useMemo(() => heldHashes(pins), [pins])

  // Its own callback, so a pin still in progress does not rerun every
  // provenance check. Only pinned hashes are looked up. Asking the cache for
  // every Library row would cost a worker round trip each.
  const readPinnedStatement = useCallback<CachedStatementReader>(
    async (hash) =>
      pinnedHashes.has(hash) ? readCachedStatement(appContext, hash) : null,
    [appContext, pinnedHashes],
  )

  const value = useMemo<PinContextValue>(
    () => ({
      pinState: (url) =>
        pinning.has(url) ? 'pinning' : pins[url] ? 'pinned' : 'unpinned',
      pin,
      unpin,
      pinnedHashes,
      readPinnedStatement,
    }),
    [pins, pinning, pin, unpin, pinnedHashes, readPinnedStatement],
  )

  return <PinContext value={value}>{children}</PinContext>
}

/** The pinned-statement reader, or undefined outside a `PinProvider`. */
export function usePinnedStatementReader(): CachedStatementReader | undefined {
  return use(PinContext)?.readPinnedStatement
}

export function usePins(): PinContextValue {
  const context = use(PinContext)
  if (context === null) {
    throw new Error('usePins must be used within a PinProvider')
  }
  return context
}
