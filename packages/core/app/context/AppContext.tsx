import { createContext, useContext } from 'react'

type AppType = 'electron-client' | 'web'

const AppContext = createContext<AppType | null>(null)

export function AppContextProvider({
  children,
  appType,
}: {
  children: React.ReactNode
  appType: AppType
}) {
  return <AppContext.Provider value={appType}>{children}</AppContext.Provider>
}

export function useAppContext() {
  const context = useContext(AppContext)
  if (context === null) {
    throw new Error('useAppContext must be used within a AppContextProvider')
  }
  return context
}
