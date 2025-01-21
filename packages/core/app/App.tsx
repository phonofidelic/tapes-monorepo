import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
// import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo'
import { Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'
import { RecordingRepoState } from '@/types'
import { AudioPlayer } from './components/AudioPlayer'
import { useAudioPlayer } from './context/AudioPlayerContext'
import Providers from './context/Providers'
import { AppContextValue } from './context/AppContext'
import { useAutomergeUrl } from './utils'

export function App({
  appContextValue,
  syncServerUrl,
}: {
  appContextValue: AppContextValue
  syncServerUrl: string
}) {
  const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()
  const [repo, setRepo] = useState<Repo | null>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<DocHandle<unknown> | null>(null)

  useEffect(() => {
    // const onEphemeralMessage = (message: any) => {
    //   console.log('got an ephemeral message: ', message)
    // }

    const initialize = async () => {
      if (repo) {
        return
      }

      // const broadcast = new BroadcastChannelNetworkAdapter()
      // TODO: Set up sync server
      const websocket = new BrowserWebSocketClientAdapter(
        // process.env.NODE_ENV === 'development'
        //   ? `ws://${import.meta.env.VITE_LOCAL_NETWORK_IP}:433`
        //   : 'wss://sync.automerge.org',
        syncServerUrl,
      )
      const indexedDB = new IndexedDBStorageAdapter()

      const _repo = new Repo({
        storage: indexedDB,
        network: [websocket],
      })

      if (automergeUrl && isValidAutomergeUrl(automergeUrl)) {
        handleRef.current = _repo.find(automergeUrl)
      } else {
        handleRef.current = _repo.create<RecordingRepoState>({ recordings: [] })
        setAutomergeUrl(handleRef.current.url)
      }

      // handleRef.current.on('ephemeral-message', onEphemeralMessage)
      // handleRef.current.broadcast({ message: 'Connected to repo' })

      setRepo(_repo)
    }
    initialize()

    // return () => {
    //   if (handleRef.current) {
    //     handleRef.current.off('ephemeral-message', onEphemeralMessage)
    //   }
    // }
  }, [])

  if (!repo) {
    return <div>Loading...</div>
  }

  return (
    <Providers
      values={{
        appContext: appContextValue,
        repoContext: repo,
      }}
    >
      <Navigation mainRef={mainRef} />
      <Main mainRef={mainRef} />
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
  // const mainRef = useRef<HTMLDivElement>(null)

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
