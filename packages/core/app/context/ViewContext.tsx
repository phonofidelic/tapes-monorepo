import { createContext, use, useState } from 'react'
import { Library } from '@/views/Library'
import { Recorder } from '@/views/Recorder'
import { Settings } from '@/views/Settings'

type View = 'recorder' | 'library' | 'settings'

const isValidView = (view: string): view is View => {
  return ['recorder', 'library', 'settings'].includes(view)
}

const ViewContext = createContext<{
  currentView: View
  setCurrentView: (view: View) => void
} | null>(null)

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const [currentViewContext, setCurrentViewContext] = useState<View>(() => {
    const storedView = localStorage.getItem('currentView')
    return storedView && isValidView(storedView) ? storedView : 'recorder'
  })

  const setCurrentView = (view: View) => {
    localStorage.setItem('currentView', view)
    setCurrentViewContext(view)
  }

  return (
    <ViewContext value={{ currentView: currentViewContext, setCurrentView }}>
      {children}
    </ViewContext>
  )
}

export function useView() {
  const context = use(ViewContext)
  if (!context) {
    throw new Error('useView must be used within a ViewProvider')
  }
  return context
}

export const navigationConfig = [
  { label: 'Recorder', view: 'recorder' },
  { label: 'Library', view: 'library' },
  { label: 'Settings', view: 'settings' },
] as const

export const viewComponentMap = {
  recorder: <Recorder />,
  library: <Library />,
  settings: <Settings />,
}
