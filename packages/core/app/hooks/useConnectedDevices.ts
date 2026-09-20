import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/context/AppContext'
import type {
  ConnectedDevicesEvent,
  GetConnectedDevicesResponse,
  SyncConnection,
} from '@/services/SyncService'

/**
 * Who is connected to this host's sync server.
 *
 * This asks for a snapshot once, then listens. The host sends the whole list on
 * every connect, disconnect and keepalive eviction. Polling instead would keep
 * showing a device that has already left until the next request.
 *
 * Subscribe first and request the snapshot second. The other order drops any
 * change that lands while the request is in flight.
 */

export type ConnectedDevicesStatus =
  /** Asked, with no answer yet. Show that we are still looking. */
  | 'loading'
  /** The host answered. The list is accurate, empty or not. */
  | 'ready'
  /**
   * The host could not answer. Either it runs no server or the call failed.
   * Kept apart from an empty list under `ready`. Both show as a blank panel but
   * mean opposite things.
   */
  | 'unavailable'
  /** Not a host. Only the desktop app runs a sync server for others to join. */
  | 'unsupported'

export type ConnectedDevicesState = {
  /** Oldest first. Only meaningful once the status is ready. */
  connections: SyncConnection[]
  status: ConnectedDevicesStatus
  /** Why the host could not answer. For diagnostics, not for the user. */
  error?: Error
  /** Asks for the snapshot again. Use it to retry after a failure. */
  refresh: () => void
}

const EMPTY: SyncConnection[] = []

/**
 * What the host last told us, and which attempt it answered. Holding the two
 * together lets a retry read as loading by derivation. Writing the status on
 * the way into the effect would cost an extra render.
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

  // Bumped by a refresh to re-run the effect below. That also remakes the
  // subscription, which is harmless and keeps the subscribe-first order.
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
        // An event means the host read its registry, so it is always a real
        // answer. That holds even when it arrives before the snapshot.
        setHeld({
          attempt,
          connections: payload?.connections ?? EMPTY,
          status: 'ready',
        })
      },
    )

    // Writes what the snapshot answered, unless an event already answered this
    // same attempt. A device can join between the request and its answer, so
    // the snapshot is the older list by then. That holds whether the snapshot
    // came back with a list or with a failure.
    const answered = (next: Held) => {
      setHeld((current) =>
        current?.attempt === attempt && current.status === 'ready'
          ? current
          : next,
      )
    }

    const failed = (error: Error) => {
      answered({ attempt, connections: EMPTY, status: 'unavailable', error })
    }

    ipc
      .send<GetConnectedDevicesResponse | undefined>(
        'sync:get-connected-devices',
      )
      .then((response) => {
        if (cancelled) {
          return
        }
        // A channel can answer with nothing at all. Treat that as a failure,
        // never as an empty list.
        if (!response?.success) {
          failed(
            response?.error instanceof Error
              ? response.error
              : new Error('The host did not answer with its connected devices'),
          )
          return
        }
        answered({
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

  // An answer to an earlier attempt describes a question we asked again.
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
