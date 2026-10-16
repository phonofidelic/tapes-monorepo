/**
 * Whether a guest can reach the host it is paired with, read from the
 * network adapter of its sync socket. That adapter's only peer is the host.
 * A shell with no host passes no connection, and core reads that as unpaired.
 */

export type HostConnection = {
  isConnected(): boolean
  /** Calls `listener` whenever `isConnected` may have changed. */
  subscribe(listener: () => void): () => void
}

/** The part of an automerge network adapter this needs. */
type PeerEvents = {
  on(event: 'peer-candidate' | 'peer-disconnected', listener: () => void): void
  off(event: 'peer-candidate' | 'peer-disconnected', listener: () => void): void
}

export function createHostConnection(adapter: PeerEvents): HostConnection {
  let connected = false
  const listeners = new Set<() => void>()

  const set = (next: boolean) => {
    if (next === connected) {
      return
    }
    connected = next
    for (const listener of listeners) {
      listener()
    }
  }
  // Held for the life of the page, like the adapter itself.
  adapter.on('peer-candidate', () => set(true))
  adapter.on('peer-disconnected', () => set(false))

  return {
    isConnected: () => connected,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
