import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  fetchAggregates,
  type AggregatesSnapshot,
  type RecordingAggregate,
} from '@/aggregatesClient'
import { type EventHost } from '@/eventTarget'
import { useAppContext } from '@/context/AppContext'

/**
 * Holds the library's playback numbers for the whole app.
 *
 * One request covers every recording, because the Library renders every row at
 * once. Fetching per row would mean a hundred requests for one screen.
 *
 * Nothing here blocks a render. Rows appear without counts and gain them when
 * the host answers. An unreachable host leaves a list without numbers, which is
 * not an error the user has to clear.
 */

/** Long enough that scrolling costs one request. Short enough that a play shows
 * up without a restart. */
export const AGGREGATES_TTL_MS = 60_000

export type AggregatesState = {
  /** Keyed by recording url. Recordings nobody has played are absent. */
  byRecording: ReadonlyMap<string, RecordingAggregate>
  /** True while a request is in flight. Never a reason to hold a render. */
  loading: boolean
  /** The last failure, for diagnostics rather than for the user. */
  error?: Error
  /** When the held snapshot was built by the host. */
  generatedAt?: string
  /**
   * Re-reads the numbers. Within the cache window this does nothing unless
   * `force` is set. A play that just landed should force it, because it makes
   * the held snapshot wrong rather than merely old.
   */
  refresh: (options?: { force?: boolean }) => void
}

const EMPTY: ReadonlyMap<string, RecordingAggregate> = new Map()

const AggregatesContext = createContext<AggregatesState>({
  byRecording: EMPTY,
  loading: false,
  refresh: () => {},
})

export function AggregatesProvider({
  target,
  children,
}: {
  /**
   * The host holding these numbers, from `resolveEventTarget`.
   *
   * A change of object identity triggers a re-read. Shells must therefore
   * return the same object while their resolution is unchanged. The electron
   * renderer uses `sameEventTarget` to do that, as it does for blob endpoints.
   */
  target: EventHost | undefined
  children: React.ReactNode
}) {
  const appContext = useAppContext()
  const ipc = appContext.type === 'electron-client' ? appContext.ipc : undefined

  // The snapshot carries the host it came from. A change of host is then
  // handled by the derivation below, with no render showing stale counts.
  const [held, setHeld] = useState<{
    target?: EventHost
    snapshot?: AggregatesSnapshot
    error?: Error
  }>({})
  const [loading, setLoading] = useState(false)

  // Refs, not state. None of these are rendered, and changing one must not
  // rebuild the callback that reads it.
  const etag = useRef<string | undefined>(undefined)
  const fetchedAt = useRef(0)
  const inFlight = useRef<AbortController | undefined>(undefined)

  const load = useCallback(
    (force: boolean) => {
      if (!target) {
        return
      }
      if (!force && Date.now() - fetchedAt.current < AGGREGATES_TTL_MS) {
        return
      }
      // One request at a time. A reconnect can land while a slow request is
      // still out, and the later answer is the one to keep.
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller

      setLoading(true)
      fetchAggregates(target, {
        ipc,
        etag: etag.current,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) {
            return
          }
          fetchedAt.current = Date.now()
          if (result.status === 'fresh') {
            etag.current = result.snapshot.etag
          }
          // An unchanged answer keeps the held snapshot as it is.
          setHeld((current) => ({
            target,
            snapshot:
              result.status === 'fresh' ? result.snapshot : current.snapshot,
          }))
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) {
            return
          }
          // The held numbers stay. Stale counts beat a list that empties
          // itself whenever the network drops.
          setHeld((current) => ({
            ...current,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          }))
        })
        .finally(() => {
          if (inFlight.current === controller) {
            inFlight.current = undefined
            setLoading(false)
          }
        })
    },
    [target, ipc],
  )

  // A new host means new numbers, so the entity tag is cleared with it.
  // Revalidating one host's tag against another could return a wrong answer.
  useEffect(() => {
    etag.current = undefined
    fetchedAt.current = 0
    load(true)
    return () => {
      inFlight.current?.abort()
      inFlight.current = undefined
    }
  }, [load])

  // Reconnecting is when the held numbers are most likely to be stale. The
  // device has been away, and a queued flush lands around the same time.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const revalidate = () => load(true)
    window.addEventListener('online', revalidate)
    return () => window.removeEventListener('online', revalidate)
  }, [load])

  const refresh = useCallback(
    (options?: { force?: boolean }) => load(options?.force ?? false),
    [load],
  )

  // Numbers from a host we no longer point at belong to another library.
  // Dropping them here means no render shows them under the new host.
  const current = held.target === target ? held : undefined

  const value = useMemo<AggregatesState>(
    () => ({
      byRecording: current?.snapshot
        ? new Map(
            current.snapshot.aggregates.map((row) => [row.recordingUrl, row]),
          )
        : EMPTY,
      loading,
      error: current?.error,
      generatedAt: current?.snapshot?.generatedAt,
      refresh,
    }),
    [current, loading, refresh],
  )

  return (
    <AggregatesContext.Provider value={value}>
      {children}
    </AggregatesContext.Provider>
  )
}

export function useAggregates(): AggregatesState {
  return useContext(AggregatesContext)
}

/**
 * One recording's numbers, or nothing.
 *
 * Nothing covers three cases: never played, no answer yet, and no host to ask.
 * They are deliberately one answer, because all three render the same way.
 */
export function useRecordingAggregate(
  recordingUrl: string | undefined,
): RecordingAggregate | undefined {
  const { byRecording } = useAggregates()
  return recordingUrl ? byRecording.get(recordingUrl) : undefined
}
