/**
 * Whether a guest can reach the host it is paired with, read from the
 * network adapter of its sync socket. That adapter's only peer is the host.
 * A shell with no host passes no connection, and core reads that as unpaired.
 *
 * A host that knows this device's key is revoked refuses the socket, which is
 * not the same as being out of range. An adapter that can tell the two apart
 * says so here, and a shell whose adapter cannot is only ever offline.
 */

export type HostConnection = {
  isConnected(): boolean
  /** Whether the host turned this device away over a revoked key. */
  isRevoked(): boolean
  /** Calls `listener` whenever either answer may have changed. */
  subscribe(listener: () => void): () => void
}

/** The part of an automerge network adapter this needs. */
type PeerEvents = {
  on(event: 'peer-candidate' | 'peer-disconnected', listener: () => void): void
  off(event: 'peer-candidate' | 'peer-disconnected', listener: () => void): void
  isRevoked?(): boolean
  onRevoked?(listener: () => void): void
}

export function createHostConnection(adapter: PeerEvents): HostConnection {
  let connected = false
  let revoked = adapter.isRevoked?.() ?? false
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const set = (next: boolean) => {
    if (next === connected) {
      return
    }
    connected = next
    notify()
  }
  // Held for the life of the page, like the adapter itself.
  adapter.on('peer-candidate', () => set(true))
  adapter.on('peer-disconnected', () => set(false))
  adapter.onRevoked?.(() => {
    if (revoked) {
      return
    }
    revoked = true
    notify()
  })

  return {
    isConnected: () => connected,
    isRevoked: () => revoked,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
