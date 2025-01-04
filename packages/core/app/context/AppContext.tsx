import { createContext, useContext } from 'react'
import { IpcService } from '@/IpcService'

export type AppContextValue =
  | {
      type: 'electron-client'
      ipc: IpcService
    }
  | {
      type: 'web-client'
      worker: Worker
    }

const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: AppContextValue
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext() {
  const context = useContext(AppContext)
  if (context === null) {
    throw new Error('useAppContext must be used within a AppContextProvider')
  }
  return context
}
