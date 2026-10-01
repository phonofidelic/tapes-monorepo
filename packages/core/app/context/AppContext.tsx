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
