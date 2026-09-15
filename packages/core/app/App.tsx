import { Suspense, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Repo } from '@automerge/automerge-repo'
import { AppIcon, Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'
import { AudioPlayer } from './components/AudioPlayer'
import Providers from './context/Providers'
import { AppContextValue } from './context/AppContext'
import type { BlobEndpoint } from './blobClient'
import type { EventHost } from './eventTarget'
import { ErrorBoundary } from './components/ErrorBoundary'

/**
 * The shared app tree. Each shell builds its own Automerge repo and passes it
 * in. The storage and network adapters are platform-specific, and only the
 * shell knows where its sync server lives. The web client persists to
 * IndexedDB. The electron renderer persists through the embedded sync
 * server's filesystem store. The shell resolves the blob endpoints and the
 * event target for the same reason.
 */
export function App({
  appContextValue,
  repoContextValue,
  blobEndpoints,
  eventTarget,
}: {
  appContextValue: AppContextValue
  /** `null` while the shell is still bootstrapping. */
  repoContextValue: Repo | null
  /**
   * The hosts recorded audio is sent to and fetched from, in the order to try
   * them. Leaving them out is supported: a standalone web client has no host,
   * so its recordings stay on the device.
   */
  blobEndpoints?: readonly BlobEndpoint[]
  /**
   * The one host that owns this library's playback numbers. A single host
   * rather than a list, because a play count lives on one host and asking
   * another returns a wrong number.
   */
  eventTarget?: EventHost
}) {
  const mainRef = useRef<HTMLDivElement | null>(null)

  return (
    <Providers
      values={{
        appContext: appContextValue,
        repoContext: repoContextValue,
        blobEndpoints,
        eventTarget,
      }}
    >
      <div className="relative flex h-full touch-none flex-col overflow-hidden">
        <span className="inline *:border-t-0 pointer-coarse:hidden">
          <Navigation mainRef={mainRef} />
        </span>
        {repoContextValue ? (
          <>
            <Main mainRef={mainRef} />
            <AudioPlayer />
          </>
        ) : (
          <ScreenLoader message="Loading repo..." />
        )}
        <span className="hidden touch-none *:border-b-0 pointer-coarse:block">
          <Navigation mainRef={mainRef} />
        </span>
      </div>
    </Providers>
  )
}

function ScreenLoader({ message = 'Loading...' }: { message: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2">
      <div className="size-39 opacity-75">
        <AppIcon />
      </div>
      <div className="text-muted w-full text-center text-lg/7">{message}</div>
    </div>
  )
}

function Navigation({
  mainRef,
}: {
  mainRef: React.RefObject<HTMLDivElement | null>
}) {
  const { currentView, setCurrentView } = useView()
  const isScrolled = useIsScrolled(mainRef)
  return (
    <nav
      className={clsx(
        'sticky top-0 z-50 w-full touch-none bg-white dark:bg-zinc-900',
        {
          'border-y dark:border-y-zinc-800': isScrolled,
        },
      )}
    >
      {/* The bar stays full-bleed so its background and border still span the
          window; only the tabs are held to the content column. Below `max-w-3xl`
          this is a no-op, so the mobile layout is unchanged. */}
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

function Main({
  mainRef,
}: {
  mainRef: React.RefObject<HTMLDivElement | null>
}) {
  const { currentView } = useView()

  return (
    // The column lives on `main` rather than an inner wrapper because the
    // Recorder view positions its visualizer and name editor `absolute`
    // against this element.
    <main
      ref={mainRef}
      className="relative box-content flex w-full flex-1 flex-col overflow-y-auto sm:mx-auto sm:max-w-3xl"
    >
      <Suspense
        fallback={<ScreenLoader message={`Loading ${currentView}...`} />}
      >
        <ErrorBoundary fallback={<p>Something went wrong</p>}>
          {viewComponentMap[currentView]}
        </ErrorBoundary>
      </Suspense>
    </main>
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
