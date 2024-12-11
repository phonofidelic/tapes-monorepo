import { clsx } from 'clsx'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from './context/ViewContext'
import Button from './components/Button'

export function App() {
  const { currentView, setCurrentView } = useView()

  return (
    <div className="h-screen w-screen overflow-hidden pt-16 text-zinc-800 dark:text-zinc-100">
      <nav className="">
        <ul className="fixed top-0 z-10 flex w-full justify-between gap-1 p-1">
          {navigationConfig.map(({ label, view }) => (
            <li key={view} className="w-full">
              <Button
                className={clsx('p-4', {
                  'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100':
                    currentView === view,
                  'text-zinc-400': currentView !== view,
                })}
                onClick={() => setCurrentView(view)}
              >
                {label}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="h-full">{viewComponentMap[currentView]}</main>
    </div>
  )
}
