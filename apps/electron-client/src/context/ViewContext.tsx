import { createContext, useContext, useState } from 'react'
import { About } from '@/views/About'
import { Library } from '@/views/Library'
import { Recorder } from '@/views/Recorder'
import { Settings } from '@/views/Settings'

type View = 'recorder' | 'library' | 'settings' | 'about'

const isValidView = (view: string): view is View => {
  return ['recorder', 'library', 'settings', 'about'].includes(view)
}

const ViewContext = createContext<{
  currentView: View
  setCurrentView: (view: View) => void
} | null>(null)

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const [currentView, setView] = useState<View>(() => {
    const storedView = localStorage.getItem('currentView')
    return storedView && isValidView(storedView) ? storedView : 'recorder'
  })

  const setCurrentView = (view: View) => {
    localStorage.setItem('currentView', view)
    setView(view)
  }

  return (
    <ViewContext.Provider value={{ currentView, setCurrentView }}>
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

export const navigationConfig = [
  { label: 'Recorder', view: 'recorder' },
  { label: 'Library', view: 'library' },
  { label: 'Settings', view: 'settings' },
  { label: 'About', view: 'about' },
] as const

export const viewComponentMap = {
  recorder: Recorder,
  library: Library,
  settings: Settings,
  about: About,
}
