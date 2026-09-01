import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { BlobDescriptor } from '@/types'
import { fetchBlobFromAny, replicateBlob } from '@/blobClient'
import {
  cacheBlob,
  evictCachedBlob,
  forgetCacheEntry,
  recordCacheHit,
} from '@/blobCache'
import { useAppContext } from './AppContext'
import { useBlobEndpoints } from './BlobContext'

/**
 * "Keep offline" pins.
 *
 * Playback caches whatever it fetches, but that only helps for recordings the
 * user has already played. A pin is an explicit promise that a recording stays
 * playable with the host switched off, so it pre-fetches immediately and is
 * exempt from cache eviction.
 *
 * Pins are per-device: which recordings *this* phone should keep is not a fact
 * about the library, so they must not go in the Automerge doc, where they
 * would sync to every peer. They also stay out of the `settings` blob, which
 * is a flat map of strings that three separate readers parse and that gets
 * rewritten whole on every unrelated setting change.
 */

const PINS_KEY = 'tapes.pins'

type PinRecord = { hash: string; size: number; pinnedAt: number }
type PinMap = Record<string, PinRecord>

export type PinState = 'unpinned' | 'pinning' | 'pinned'

type PinContextValue = {
  pinState: (url: AutomergeUrl) => PinState
  pin: (url: AutomergeUrl, descriptor: BlobDescriptor) => Promise<void>
  unpin: (url: AutomergeUrl) => Promise<void>
  pinnedHashes: ReadonlySet<string>
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

export function PinProvider({ children }: { children: React.ReactNode }) {
  const appContext = useAppContext()
  const endpoints = useBlobEndpoints()
  const [pins, setPins] = useState<PinMap>(readPins)
  const [pinning, setPinning] = useState<ReadonlySet<string>>(new Set())

  const pin = useCallback(
    async (url: AutomergeUrl, descriptor: BlobDescriptor) => {
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
          })
        }
        await cacheBlob(appContext, descriptor, blob, url)
        recordCacheHit(descriptor.hash, descriptor.size, localStorage)

        // Without a persistence grant the browser is free to evict OPFS under
        // storage pressure — including the copy the user explicitly asked to
        // keep. Ask the first time anything is pinned.
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
      setPins((current) => {
        const next = { ...current }
        delete next[url]
        writePins(next)
        return next
      })
      if (record) {
        // Drop the bytes as well as the promise: an unpinned recording is
        // ordinary cache again, and the user asked for the space back.
        await evictCachedBlob(appContext, record.hash)
        forgetCacheEntry(record.hash, localStorage)
      }
    },
    [appContext, pins],
  )

  const value = useMemo<PinContextValue>(
    () => ({
      pinState: (url) =>
        pinning.has(url) ? 'pinning' : pins[url] ? 'pinned' : 'unpinned',
      pin,
      unpin,
      pinnedHashes: new Set(Object.values(pins).map((record) => record.hash)),
    }),
    [pins, pinning, pin, unpin],
  )

  return <PinContext.Provider value={value}>{children}</PinContext.Provider>
}

export function usePins(): PinContextValue {
  const context = useContext(PinContext)
  if (context === null) {
    throw new Error('usePins must be used within a PinProvider')
  }
  return context
}
