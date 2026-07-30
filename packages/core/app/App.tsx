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

/**
 * The shared app tree. Each shell builds its own `Repo` and passes it in: the
 * storage and network adapters a repo needs are platform-specific (the web
 * client persists to IndexedDB, the electron renderer delegates persistence to
 * the embedded sync server's filesystem store), and only the shell knows where
 * its sync server lives. `null` means the shell is still bootstrapping.
 */
export function App({
  appContextValue,
  repoContextValue,
}: {
  appContextValue: AppContextValue
  repoContextValue: Repo | null
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
      <ul className="flex w-full justify-between gap-1 p-1">
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
    <main
      ref={mainRef}
      className={clsx(
        'fixed bottom-0 left-0 right-0 box-content flex flex-col overflow-y-auto p-5',
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
