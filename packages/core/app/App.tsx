import { Suspense, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from './context/ViewContext'
import {
  ErrorBoundary,
  GenericErrorFallbackScreen,
} from './components/ErrorBoundary'
import { PortalContainer } from './context/PortalsContext'
import { PendingVouches } from './components/PendingVouches'
import { PersonKeyBackupPrompt } from './components/PersonKeyBackupPrompt'
import { ScreenLoader } from './components/ScreenLoader'
import './index.css'

/**
 * The shared app tree. Each shell builds its own Automerge repo and passes it
 * in a Providers wrapper. The storage and network adapters are platform-specific,
 * and only the shell knows where its sync server lives. The web client persists to
 * IndexedDB. The electron renderer persists through the embedded sync
 * server's filesystem store. The shell resolves the blob endpoints and the
 * event target for the same reason.
 */
export function App() {
  const mainRef = useRef<HTMLDivElement | null>(null)
  const isScrolled = useIsScrolled(mainRef)
  const { currentView } = useView()

  return (
    <div className="relative flex h-full w-full touch-none flex-col overflow-hidden">
      <div className="relative mr-4 flex h-full w-full shrink touch-none overflow-y-auto max-md:flex-col md:flex-row">
        <div
          className={clsx('max-md:bg-surface sticky top-0 z-40 md:bg-none', {
            'border-b-subtle border-b': isScrolled,
          })}
        >
          <div className="pointer-coarse:hidden">
            <Navigation />
          </div>
        </div>
        <main
          ref={mainRef}
          className="relative top-0 bottom-0 box-content flex h-full w-full touch-pan-y flex-col overflow-y-auto"
        >
          <ErrorBoundary
            fallback={
              <GenericErrorFallbackScreen
                onTryRecover={() => window.location.reload()}
              />
            }
          >
            <Suspense
              fallback={<ScreenLoader message={`Loading ${currentView}...`} />}
            >
              {viewComponentMap[currentView]}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <div
        className={clsx(
          'border-t-subtle bottom-0 z-40 h-full w-full flex-1 border-t',
          {
            'border-t-subtle border-t drop-shadow-[0px_-4px_3px_rgba(24,24,27,0.03)] dark:drop-shadow-none':
              currentView !== 'recorder',
          },
        )}
      >
        <div className="relative">
          <PortalContainer containerRefKey="editorPortal" />
          <PortalContainer containerRefKey="audioPlayerPortal" />
        </div>
        <div className="bg-surface sticky bottom-0 z-50 w-full not-pointer-coarse:hidden">
          <Navigation />
        </div>
      </div>
      <PersonKeyBackupPrompt />
      <PendingVouches />
    </div>
  )
}

function Navigation() {
  const { currentView, setCurrentView } = useView()
  return (
    <nav className="flex w-full touch-none justify-center">
      <ul className="mx-auto flex w-full max-w-3xl justify-between gap-1 p-1 md:mx-0 md:not-pointer-coarse:flex-col">
        {navigationConfig.map(({ label, view }) => (
          <li key={view} className="w-full">
            <Button
              className={clsx('size-full justify-center p-4', {
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
  )
}

function useIsScrolled(ref: React.RefObject<HTMLElement | null>) {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element === null) {
      return
    }
    const handleScroll = () => {
      setIsScrolled(element.scrollTop > 0)
    }
    element.addEventListener('scroll', handleScroll)
    return () => {
      element.removeEventListener('scroll', handleScroll)
    }
  }, [ref])

  return isScrolled
}
