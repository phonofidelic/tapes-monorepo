import { Suspense, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { AppIcon, Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAudioPlayer } from './context/AudioPlayerContext'

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
  const { audioPlayerPortalRef } = useAudioPlayer()
  const isScrolled = useIsScrolled(mainRef)
  const { currentView } = useView()

  return (
    <div className="relative flex h-full touch-none flex-col overflow-hidden">
      <div
        className={clsx('bg-surface sticky top-0 z-50', {
          'border-b-subtle border-b': isScrolled,
        })}
      >
        <div className="pointer-coarse:hidden">
          <Navigation />
        </div>
      </div>
      <Suspense
        fallback={<ScreenLoader message={`Loading ${currentView}...`} />}
      >
        <main
          ref={mainRef}
          className="relative box-content flex w-full flex-1 touch-pan-y flex-col overflow-y-auto sm:mx-auto sm:max-w-3xl"
        >
          <ErrorBoundary
            fallback={
              <ScreenLoader message={'Something went wrong'}>
                <Button
                  className="border p-1 px-2"
                  onClick={() => window.location.reload()}
                >
                  {' '}
                  Reload
                </Button>
              </ScreenLoader>
            }
          >
            <Suspense
              fallback={<ScreenLoader message={`Loading ${currentView}...`} />}
            >
              {viewComponentMap[currentView]}
            </Suspense>
          </ErrorBoundary>
        </main>
        {/* Div that contains the audio player portal */}
        <div ref={audioPlayerPortalRef}></div>
      </Suspense>
      <div
        className={clsx(
          'sticky bottom-0 w-full not-pointer-coarse:hidden before:mt-16',
          {
            'border-t-subtle border-t': currentView !== 'recorder',
          },
        )}
      >
        <Navigation />
      </div>
    </div>
  )
}

export function ScreenLoader({
  message = 'Loading...',
  children,
}: {
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2">
      <div className="size-39 opacity-75">
        <AppIcon />
      </div>
      <div className="text-muted w-full text-center text-lg/7">{message}</div>
      <div className="flex w-full justify-center">{children}</div>
    </div>
  )
}

function Navigation() {
  const { currentView, setCurrentView } = useView()
  return (
    <nav className="bg-surface top-0 z-50 w-full touch-none">
      <ul className="mx-auto flex w-full max-w-3xl justify-between gap-1 p-1">
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
