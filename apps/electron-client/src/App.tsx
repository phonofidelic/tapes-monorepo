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
    <div className="relative h-screen w-screen select-none overflow-hidden pt-[32px] text-zinc-800 dark:text-zinc-100">
      <div id="titlebar" className="absolute top-0 z-50 h-[32px] w-full" />
      <nav className="">
        <ul className="flex w-full justify-between gap-1 p-1">
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
