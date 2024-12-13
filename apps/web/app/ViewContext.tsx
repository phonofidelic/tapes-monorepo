'use client'

import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'

type View = 'recorder' | 'library' | 'settings' | 'about'

const isValidView = (view: string): view is View => {
  return ['recorder', 'library', 'settings', 'about'].includes(view)
}

const ViewContext = createContext<{
  currentView: View
} | null>(null)

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const [currentView, setView] = useState<View | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    const path = pathname.split('/')[1]
    if (path && isValidView(path)) {
      localStorage.setItem('currentView', path)
      setView(path)
      return
    }

    const storedView = localStorage.getItem('currentView')
    if (storedView && isValidView(storedView)) {
      setView(storedView)
    } else {
      setView('recorder')
    }
  }, [pathname])

  if (!currentView) {
    return null
  }

  return (
    <ViewContext.Provider value={{ currentView }}>
      {children}
    </ViewContext.Provider>
  )
}

export function useView() {
  const context = useContext(ViewContext)
  if (!context) {
    throw new Error('useView must be used within a ViewProvider')
  }
  return context
}
