import { useState } from 'react'
import { clsx } from 'clsx'

type View = 'recorder' | 'library' | 'settings' | 'about'

export function App() {
  const [currentView, setCurrentView] = useState<View>('recorder')
  return (
    <div>
      <nav>
        <ul className="flex w-full justify-between">
          {navigationConfig.map(({ label, view }) => (
            <li key={view}>
              <button
                className={clsx({
                  underline: currentView === view,
                })}
                onClick={() => setCurrentView(view)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {viewComponentMap[currentView]()}
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

function Recorder() {
  return <h1 className="bg-green-500">Recorder</h1>
}
function Library() {
  return <h1 className="bg-blue-500">Library</h1>
}
function Settings() {
  return <h1 className="bg-red-500">Settings</h1>
}
function About() {
  return <h1 className="bg-yellow-500">About</h1>
}
