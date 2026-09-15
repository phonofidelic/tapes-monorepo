import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/context/AppContext'
import type {
  ConnectedDevicesEvent,
  GetConnectedDevicesResponse,
  SyncConnection,
} from '@/IpcService'

/**
 * Who is connected to this host's sync server, kept current without polling.
 *
 * A snapshot request would have to be repeated on a timer to stay true, and
 * between ticks the list is wrong: a phone that walked out of range still shows
 * as here. So this asks once and then listens — the host pushes the whole new
 * list on every connect, disconnect and keepalive eviction.
 *
 * The subscription is set up before the snapshot is requested, deliberately. The
 * other order drops any change that lands while the request is in flight, and
 * the list would then stay wrong until the next unrelated change.
 */

export type ConnectedDevicesStatus =
  /** Asked; no answer yet. Show that we are looking, not that nobody is here. */
  | 'loading'
  /** The host answered. `connections` is the truth, empty or not. */
  | 'ready'
  /**
   * The host could not answer — not running a server, or the call failed.
   * Distinct from `ready` with an empty list, because "nobody is connected" and
   * "we could not ask" look identical in a blank panel and mean opposite
   * things. TAP-88 is the same failure on the LAN and HTTPS toggles.
   */
  | 'unavailable'
  /** Not a host. Only the desktop app runs a sync server for others to join. */
  | 'unsupported'

export type ConnectedDevicesState = {
  /** Oldest first. Only meaningful when `status` is `ready`. */
  connections: SyncConnection[]
  status: ConnectedDevicesStatus
  /** Why the host could not answer, for diagnostics rather than for the user. */
  error?: Error
  /** Re-reads the snapshot. The push keeps it current; this is for a retry. */
  refresh: () => void
}

const EMPTY: SyncConnection[] = []

/**
 * What the host last told us, and which attempt it answered. Held together so
 * a retry reads as `loading` by derivation rather than by a write on the way
 * into the effect, which would cost a cascading render.
 */
type Held = {
  attempt: number
  connections: SyncConnection[]
  status: 'ready' | 'unavailable'
  error?: Error
}

export function useConnectedDevices(): ConnectedDevicesState {
  const appContext = useAppContext()
  const ipc = appContext.type === 'electron-client' ? appContext.ipc : undefined

  // Bumped by `refresh` to re-run the effect below, which re-requests the
  // snapshot. The subscription is torn down and remade with it, which is
  // harmless and keeps the subscribe-then-request order intact.
  const [attempt, setAttempt] = useState(0)
  const [held, setHeld] = useState<Held | null>(null)

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!ipc) {
      return
    }

    let cancelled = false

    const unsubscribe = ipc.subscribe<ConnectedDevicesEvent>(
      'sync:connected-devices',
      (payload) => {
        if (cancelled) {
          return
        }
        // A push is the host telling us the list changed, so it always answers
        // the question — even when it arrives before the snapshot does.
        setHeld({
          attempt,
          connections: payload?.connections ?? EMPTY,
          status: 'ready',
        })
      },
    )

    const failed = (error: Error) => {
      setHeld((current) =>
        // A push may already have given us the real list while the request was
        // in flight. Do not overwrite the truth with a stale failure.
        current?.attempt === attempt && current.status === 'ready'
          ? current
          : { attempt, connections: EMPTY, status: 'unavailable', error },
      )
    }

    ipc
      .send<GetConnectedDevicesResponse | undefined>(
        'sync:get-connected-devices',
      )
      .then((response) => {
        if (cancelled) {
          return
        }
        // `undefined` is the TAP-88 shape: a channel that answered with
        // nothing. Treated as a failure, never as an empty list.
        if (!response?.success) {
          failed(
            response?.error instanceof Error
              ? response.error
              : new Error('The host did not answer with its connected devices'),
          )
          return
        }
        setHeld({
          attempt,
          connections: response.data.connections ?? EMPTY,
          status: 'ready',
        })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        failed(error instanceof Error ? error : new Error(String(error)))
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [ipc, attempt])

  if (!ipc) {
    return { connections: EMPTY, status: 'unsupported', refresh }
  }

  // An answer to an earlier attempt describes a question we have asked again.
  if (!held || held.attempt !== attempt) {
    return { connections: EMPTY, status: 'loading', refresh }
  }

  return {
    connections: held.connections,
    status: held.status,
    error: held.error,
    refresh,
  }
}
