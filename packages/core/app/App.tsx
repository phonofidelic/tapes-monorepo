import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo'
import { RepoContext } from '@automerge/automerge-repo-react-hooks'
import { Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'
import { useAppContext } from './context/AppContext'
import { useSetting } from './context/SettingsContext'
import { RecordingRepoState } from '@/types'

export function App() {
  const appContext = useAppContext()
  const [automergeUrl, setAutomergeUrl] = useSetting('automergeUrl')
  const { currentView, setCurrentView } = useView()
  const [repo, setRepo] = useState<any | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<DocHandle<unknown> | null>(null)

  useEffect(() => {
    const onEphemeralMessage = (message: any) => {
      console.log('got an ephemeral message: ', message)
    }

    const initialize = async () => {
      if (repo) {
        return
      }

      const broadcast = new BroadcastChannelNetworkAdapter()
      // TODO: Set up sync server
      const websocket = new BrowserWebSocketClientAdapter(
        'wss://sync.automerge.org',
      )
      const indexedDB = new IndexedDBStorageAdapter()

      const _repo = new Repo({
        storage: indexedDB,
        network: [websocket, broadcast],
      })

      const storedAutomergeUrl = appContext.automergeUrl ?? automergeUrl

      if (storedAutomergeUrl && isValidAutomergeUrl(storedAutomergeUrl)) {
        handleRef.current = _repo.find(storedAutomergeUrl)
        setAutomergeUrl(storedAutomergeUrl)
      } else {
        handleRef.current = _repo.create<RecordingRepoState>({ recordings: [] })
        setAutomergeUrl(handleRef.current.url)
      }

      handleRef.current.on('ephemeral-message', onEphemeralMessage)
      handleRef.current.broadcast({ message: 'Connected to repo' })

      setRepo(_repo)
    }
    initialize()

    return () => {
      if (handleRef.current) {
        handleRef.current.off('ephemeral-message', onEphemeralMessage)
      }
    }
  }, [])

  useEffect(() => {
    const onScroll = () => {
      if (!mainRef.current) {
        return
      }
      const { scrollTop } = mainRef.current
      setIsScrolled(scrollTop > 0)
    }

    mainRef.current?.addEventListener('scroll', onScroll)

    return () => {
      mainRef.current?.removeEventListener('scroll', onScroll)
    }
  }, [repo])

  if (!repo) {
    return <div>Loading...</div>
  }

  return (
    <RepoContext.Provider value={repo}>
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
      <main
        ref={mainRef}
        className="fixed bottom-0 left-0 right-0 box-content flex flex-col overflow-y-auto p-5"
      >
        {viewComponentMap[currentView]}
      </main>
    </RepoContext.Provider>
  )
}
