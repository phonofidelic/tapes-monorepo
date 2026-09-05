import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Repo } from '@automerge/automerge-repo'
import { Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'
import { AudioPlayer } from './components/AudioPlayer'
import { useAudioPlayer } from './context/AudioPlayerContext'
import Providers from './context/Providers'
import { AppContextValue } from './context/AppContext'
import type { BlobEndpoint } from './blobClient'
import type { EventHost } from './eventTarget'

/**
 * The shared app tree. Each shell builds its own `Repo` and passes it in: the
 * storage and network adapters a repo needs are platform-specific (the web
 * client persists to IndexedDB, the electron renderer delegates persistence to
 * the embedded sync server's filesystem store), and only the shell knows where
 * its sync server lives. `null` means the shell is still bootstrapping.
 *
 * `blobEndpoints` are the hosts recorded audio is sent to and fetched from, in
 * the order to try them, resolved by the shell for the same reason. Leaving
 * them out is a supported mode: a standalone web client has no host, so its
 * recordings stay on the device.
 *
 * `eventTarget` is the single host that owns this library's playback numbers,
 * resolved by the shell through `resolveEventTarget`. One host and not a list:
 * bytes are content addressed so any host holding them will do, but a play
 * count is held by one host and asking a second would return the wrong number
 * rather than none.
 */
export function App({
  appContextValue,
  repoContextValue,
  blobEndpoints,
  eventTarget,
}: {
  appContextValue: AppContextValue
  repoContextValue: Repo | null
  blobEndpoints?: readonly BlobEndpoint[]
  eventTarget?: EventHost
}) {
  const mainRef = useRef<HTMLDivElement | null>(null)

  if (!repoContextValue) {
    return <div>Loading...</div>
  }

  return (
    <Providers
      values={{
        appContext: appContextValue,
        repoContext: repoContextValue,
        blobEndpoints,
        eventTarget,
      }}
    >
      <Main mainRef={mainRef} />
      <Navigation mainRef={mainRef} />
      <AudioPlayer />
    </Providers>
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
      className={clsx('w-full bg-white dark:bg-zinc-900', {
        'border-b dark:border-b-zinc-800': isScrolled,
      })}
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
  const { currentUrl } = useAudioPlayer()

  return (
    // `max-w-3xl` centers `main` itself rather than an inner wrapper, because
    // the Recorder view positions its visualizer and transport `absolute`
    // against this element — a wrapper would leave them full-bleed. Below
    // `3xl` the constraint never binds, so the mobile layout is unchanged.
    <main
      ref={mainRef}
      className={clsx(
        'fixed right-0 bottom-0 left-0 mx-auto box-content flex max-w-3xl flex-col overflow-y-auto p-5',
        {
          'pb-20': currentUrl !== undefined,
        },
      )}
    >
      {viewComponentMap[currentView]}
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
