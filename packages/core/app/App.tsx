'use client'

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import wasmUrl from '@automerge/automerge/automerge.wasm?url'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { Repo } from '@automerge/automerge-repo/slim'
import { next as Automerge } from '@automerge/automerge/slim'
import { RepoContext } from '@automerge/automerge-repo-react-hooks'
import { Button } from '@tapes-monorepo/ui'
import {
  useView,
  navigationConfig,
  viewComponentMap,
} from '@/context/ViewContext'
import './index.css'

export function App() {
  const { currentView, setCurrentView } = useView()
  const [repo, setRepo] = useState<Repo | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const mainRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const initialize = async () => {
      if (repo) {
        return
      }

      await Automerge.initializeWasm(wasmUrl)

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

      setRepo(_repo)
    }
    initialize()
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
