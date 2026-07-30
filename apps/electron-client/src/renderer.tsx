import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  App,
  IpcService,
  SyncServerInfo,
  resolveBlobEndpoint,
  useAutomergeUrl,
  type BlobEndpoint,
} from '@tapes-monorepo/core'
import './index.css'
import { DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import {
  bootstrapRendererRepo,
  readSyncSettings,
  resolveSyncServerUrls,
  type SyncServerUrls,
} from './rendererRepo'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const appContextValue = {
  type: 'electron-client' as const,
  ipc: new IpcService(),
}

function ElectronAppRoot() {
  const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()

  const [syncServerUrls, setSyncServerUrls] = useState<SyncServerUrls | null>(
    null,
  )
  const [blobEndpoint, setBlobEndpoint] = useState<BlobEndpoint | undefined>()
  const [repo, setRepo] = useState<Repo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<DocHandle<unknown> | null>(null)
  const didInitRef = useRef(false)

  // The embedded server's url only arrives over IPC, and the repo must be built
  // with its adapters already in place: `Repo.find` waits for the network to be
  // ready and then requests the doc, so a repo built before the url resolves
  // would have no peer to ask and report the library as unavailable.
  useEffect(() => {
    appContextValue.ipc
      .send<SyncServerInfo>('sync:get-server-info')
      .then((info) => {
        const urls = resolveSyncServerUrls({
          settings: readSyncSettings(localStorage),
          serverInfo: info,
          envSyncServerUrl: import.meta.env.VITE_SYNC_SERVER_URL,
        })
        if (!urls.localUrl) {
          console.error(
            'Embedded sync server is not running: recordings made in this session will not be stored on disk',
          )
        }
        setSyncServerUrls(urls)
        // Recorded audio goes to the embedded server's own HTTP surface, which
        // it advertises alongside the sync socket.
        setBlobEndpoint(resolveBlobEndpoint({ syncServerInfo: info }))
      })
      .catch((ipcError) => {
        console.error('Failed to reach the embedded sync server', ipcError)
        setError('Could not reach the local sync server.')
      })
  }, [])

  useEffect(() => {
    if (!syncServerUrls) {
      return
    }

    const initialize = async () => {
      // Guard against re-init (StrictMode double-invoke, dep changes). A `repo`
      // state check can't do this: initialize() is async and setRepo lands only
      // at the end, so concurrent runs would each build a Repo and websocket.
      if (didInitRef.current) {
        return
      }
      didInitRef.current = true

      const result = await bootstrapRendererRepo({
        storedUrl:
          automergeUrl && isValidAutomergeUrl(automergeUrl)
            ? automergeUrl
            : null,
        urls: syncServerUrls,
        createStorage: () => new IndexedDBStorageAdapter(),
      })

      if (result.status === 'unavailable') {
        // Creating a fresh doc here would be indistinguishable from silently
        // losing the library.
        setError('Your library could not be loaded from this device.')
        return
      }

      handleRef.current = result.handle
      if (result.createdUrl) {
        setAutomergeUrl(result.createdUrl)
      }
      setRepo(result.repo)
    }
    initialize()
  }, [automergeUrl, setAutomergeUrl, syncServerUrls])

  if (error) {
    return <div>{error}</div>
  }

  if (!repo) {
    return <div>Loading...</div>
  }

  return (
    <App
      appContextValue={appContextValue}
      repoContextValue={repo}
      blobEndpoint={blobEndpoint}
    />
  )
}

const root = createRoot(rootElement)
root.render(
  <StrictMode>
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100vw',
        userSelect: 'none',
        paddingTop: '32px',
      }}
    >
      <div
        id="titlebar"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '32px',
          zIndex: 999,
        }}
      />
      <ElectronAppRoot />
    </div>
  </StrictMode>,
)
