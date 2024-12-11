import { useState } from 'react'
import { clsx } from 'clsx'
import { Recorder } from './views/Recorder'
import { Library } from './views/Library'
import { About } from './views/About'
import { Settings } from './views/Settings'

type View = 'recorder' | 'library' | 'settings' | 'about'

export function App() {
  const [currentView, setCurrentView] = useState<View>('recorder')
  return (
    <div className="h-screen w-screen overflow-hidden pt-16 text-zinc-800 dark:text-zinc-100">
      <nav className="">
        <ul className="fixed top-0 z-10 flex w-full justify-between gap-1 p-1">
          {navigationConfig.map(({ label, view }) => (
            <li key={view} className="w-full">
              <button
                className={clsx(
                  'flex w-full cursor-default justify-center rounded p-4 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  {
                    'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100':
                      currentView === view,
                    'text-zinc-400': currentView !== view,
                  },
                )}
                onClick={() => setCurrentView(view)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="h-full">{viewComponentMap[currentView]()}</main>
    </div>
  )
}

const navigationConfig = [
  { label: 'Recorder', view: 'recorder' },
  { label: 'Library', view: 'library' },
  { label: 'Settings', view: 'settings' },
  { label: 'About', view: 'about' },
] as const

const viewComponentMap = {
  recorder: Recorder,
  library: Library,
  settings: Settings,
  about: About,
}
