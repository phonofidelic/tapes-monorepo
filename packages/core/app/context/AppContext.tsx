import { IpcService } from '@/IpcService'
import { createContext, useContext } from 'react'

const AppContext = createContext<
  | {
      type: 'electron-client'
      ipc: IpcService
    }
  | {
      type: 'web'
    }
  | null
>(null)

export function AppContextProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value:
    | {
        type: 'electron-client'
        ipc: IpcService
      }
    | {
        type: 'web'
      }
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
