import type { WebSocket } from 'ws'

/**
 * Who is connected to this host's sync server right now.
 *
 * `wss.clients` already holds every open socket, but a socket carries none of
 * what a presence list needs: the name the guest gave on the handshake, when it
 * arrived, whether it is this machine's own window. The registry keeps that
 * next to each socket and tells its listener whenever the set changes.
 *
 * Two things make a presence list lie, and both are handled here. A LAN
 * connection that goes away — a phone carried out of range — often never fires
 * `close`, so the registry pings and evicts whatever stops answering. And the
 * host's own window is a peer like any other, so it is marked rather than
 * listed as one of its own guests.
 */

/** One open sync connection, as the UI needs to see it. */
export type SyncConnection = {
  /** Stable for the life of the connection. Not a device identity. */
  id: string
  /**
   * The name the guest gave on the handshake, already sanitized. Undefined
   * when it sent nothing usable, so the UI picks what to show instead.
   */
  label?: string
  /** Remote address of the socket, for telling same-named devices apart. */
  address?: string
  /** Epoch milliseconds, for "connected 3 minutes ago". */
  connectedAt: number
  /** This host's own window rather than a guest. */
  self: boolean
}

/**
 * How often sockets are pinged. A socket that misses a ping is evicted on the
 * next tick, so a dead connection leaves the list within two intervals. Long
 * enough to be cheap, short enough that a list nobody is watching does not go
 * stale for minutes.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000

export type SyncConnectionDetails = Omit<SyncConnection, 'id' | 'connectedAt'>

export type SyncConnectionRegistry = {
  /** Registers an open socket and returns the connection it became. */
  add(socket: WebSocket, details: SyncConnectionDetails): SyncConnection
  /** The current connections, oldest first. */
  list(): SyncConnection[]
  /** Stops the keepalive and drops every entry. Emits the empty list. */
  close(): void
}

type Entry = {
  connection: SyncConnection
  /** Answered the last ping. Cleared on each tick, set by `pong`. */
  alive: boolean
}

let nextId = 1

export function createSyncConnectionRegistry({
  onChange,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  now = Date.now,
}: {
  /** Called with the new list after every connect, disconnect and eviction. */
  onChange: (connections: SyncConnection[]) => void
  heartbeatIntervalMs?: number
  now?: () => number
}): SyncConnectionRegistry {
  // Keyed by socket, so the close handler can find its own entry and a socket
  // can never be registered twice.
  const entries = new Map<WebSocket, Entry>()

  const list = () => [...entries.values()].map((entry) => entry.connection)

  const remove = (socket: WebSocket) => {
    // Idempotent: a socket we terminate ourselves also fires `close`, and a
    // second removal must not emit a change that did not happen.
    if (!entries.delete(socket)) {
      return
    }
    onChange(list())
  }

  const heartbeat = setInterval(() => {
    for (const [socket, entry] of entries) {
      if (!entry.alive) {
        // Nothing came back since the last ping. `terminate` closes the socket
        // without waiting for a handshake that is not going to arrive.
        socket.terminate()
        remove(socket)
        continue
      }
      entry.alive = false
      socket.ping()
    }
  }, heartbeatIntervalMs)
  // The timer must never be the reason the process stays up.
  heartbeat.unref?.()

  return {
    add(socket, details) {
      const connection: SyncConnection = {
        id: `sync-connection-${nextId++}`,
        connectedAt: now(),
        ...details,
      }
      entries.set(socket, { connection, alive: true })
      socket.on('pong', () => {
        const entry = entries.get(socket)
        if (entry) {
          entry.alive = true
        }
      })
      socket.on('close', () => remove(socket))
      // A socket that errors is on its way out but does not always say so.
      socket.on('error', () => remove(socket))
      onChange(list())
      return connection
    },

    list,

    close() {
      clearInterval(heartbeat)
      entries.clear()
      onChange([])
    },
  }
}
