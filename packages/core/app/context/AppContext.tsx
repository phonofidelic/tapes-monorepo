import { createContext, use } from 'react'
import { IpcService } from '@/IpcService'

export type AppContextValue =
  | {
      type: 'electron-client'
      ipc: IpcService
    }
  | {
      type: 'web-client'
      worker: Worker
      /**
       * Whether the sync socket to the host is up. A take started while it is
       * down signs no session, because the doc may show one that has closed.
       * Absent on a shell with no host.
       */
      isHostConnected?: () => boolean
    }

const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: AppContextValue
}) {
  return <AppContext value={value}>{children}</AppContext>
}

export function useAppContext() {
  const context = use(AppContext)
  if (context === null) {
    throw new Error('useAppContext must be used within a AppContextProvider')
  }
  return context
}
