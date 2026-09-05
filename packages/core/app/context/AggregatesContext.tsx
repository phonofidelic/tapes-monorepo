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
 * The library's playback numbers, held for the whole app rather than fetched
 * per row.
 *
 * One request covers every recording. The Library renders its whole list at
 * once, so a hook that fetched per row would turn one screen into a hundred
 * round trips for a few hundred bytes.
 *
 * **Nothing here ever blocks a render.** These numbers are slow-moving
 * decoration on a list that is perfectly usable without them: the first paint
 * shows rows with no counts, and counts appear when the host answers. A host
 * that is away or unpaired is not an error state the user has to clear — it is
 * a list without numbers, which is what an offline guest should see.
 */

/** Long enough that scrolling a library costs one request, short enough that a
 * play you just finished shows up without a restart. */
export const AGGREGATES_TTL_MS = 60_000

export type AggregatesState = {
  /** Keyed by recording url. Recordings nobody has played are absent. */
  byRecording: ReadonlyMap<string, RecordingAggregate>
  /** True while a request is in flight; never a reason to hold a render. */
  loading: boolean
  /** The last failure, kept for diagnostics rather than for the user. */
  error?: Error
  /** When the held snapshot was built by the host. */
  generatedAt?: string
  /**
   * Re-reads the numbers. Within the TTL this is a no-op unless `force` is
   * set — which is what a just-flushed play should pass, having made the held
   * snapshot wrong rather than merely old.
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
   * Identity is the signal to re-read, so a shell must hand back the same
   * object while its resolution is unchanged — `sameEventTarget` is there for
   * exactly that, and the electron renderer resolves this on every settings
   * write. The same contract `blobEndpoints` is held to.
   */
  target: EventHost | undefined
  children: React.ReactNode
}) {
  const appContext = useAppContext()
  const ipc = appContext.type === 'electron-client' ? appContext.ipc : undefined

  // The held snapshot carries the host it came from, so a change of host is a
  // derivation rather than a reset: the old numbers stop being shown the
  // moment they stop applying, without a render that clears them first.
  const [held, setHeld] = useState<{
    target?: EventHost
    snapshot?: AggregatesSnapshot
    error?: Error
  }>({})
  const [loading, setLoading] = useState(false)

  // Refs, not state: nothing here is rendered, and a change to any of them
  // must not rebuild the callback that reads it.
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
      // One request at a time. A reconnect can arrive while a slow request is
      // still out, and the later answer is the one worth having.
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
          // `unchanged` leaves the held snapshot alone; that it is still
          // current is the whole answer.
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
          // The held numbers are kept. Stale counts beside a host that is
          // temporarily away are better than a list that empties itself
          // whenever the network hiccups.
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

  // A new host means new numbers, so the tag goes with it: revalidating one
  // host's tag against another's would be meaningless, and a 304 from it would
  // be wrong. What is already held stops being *shown* by derivation below.
  useEffect(() => {
    etag.current = undefined
    fetchedAt.current = 0
    load(true)
    return () => {
      inFlight.current?.abort()
      inFlight.current = undefined
    }
  }, [load])

  // Reconnecting is the moment the held numbers are most likely to be wrong —
  // the device has been away, and other people have been playing tapes. It is
  // also when a queued flush lands, so the counts on the other side have just
  // moved.
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

  // Numbers from a host we are no longer pointed at are another library's, so
  // they are dropped here rather than cleared in an effect — there is no render
  // in which the old counts sit under the new host.
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
 * One recording's numbers, or `undefined` when it has never been played, the
 * host has not answered yet, or there is no host to ask.
 *
 * Those three are deliberately one answer. A caller that told them apart would
 * be deciding what to render from how the network went, and every one of them
 * means the same thing on screen: this row has no numbers to show.
 */
export function useRecordingAggregate(
  recordingUrl: string | undefined,
): RecordingAggregate | undefined {
  const { byRecording } = useAggregates()
  return recordingUrl ? byRecording.get(recordingUrl) : undefined
}
