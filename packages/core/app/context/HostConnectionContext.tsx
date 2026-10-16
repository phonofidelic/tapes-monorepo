import { createContext, use, useSyncExternalStore } from 'react'
import type { HostConnection } from '@/hostConnection'

const HostConnectionContext = createContext<HostConnection | undefined>(
  undefined,
)

export function HostConnectionProvider({
  connection,
  children,
}: {
  connection: HostConnection | undefined
  children: React.ReactNode
}) {
  return (
    <HostConnectionContext value={connection}>{children}</HostConnectionContext>
  )
}

export type HostConnectionStatus = 'unpaired' | 'connected' | 'offline'

const NO_HOST: HostConnection = {
  isConnected: () => false,
  subscribe: () => () => {},
}

/** Whether this guest can reach its host right now. */
export function useHostConnection(): HostConnectionStatus {
  const connection = use(HostConnectionContext)
  const store = connection ?? NO_HOST
  const connected = useSyncExternalStore(store.subscribe, store.isConnected)
  if (!connection) {
    return 'unpaired'
  }
  return connected ? 'connected' : 'offline'
}
