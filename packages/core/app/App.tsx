import { clsx } from 'clsx'
import { Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'

export function App() {
  const { currentView, setCurrentView } = useView()

  return (
    <>
      <nav className="">
        <ul className="flex w-full justify-between gap-1 p-1">
          {navigationConfig.map(({ label, view }) => (
            <li key={view} className="w-full">
              <Button
                className={clsx('justify-center p-4', {
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
    </>
  )
}
