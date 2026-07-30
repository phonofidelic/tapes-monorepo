import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  App,
  IpcService,
  RecordingRepoState,
  SyncServerInfo,
  useAutomergeUrl,
} from '@tapes-monorepo/core'
import './index.css'
import { DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import {
  buildRendererNetwork,
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

/** How long to wait for a peer to answer with the stored library. */
const FIND_TIMEOUT_MS = 10_000

function ElectronAppRoot() {
  const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()

  const [syncServerUrls, setSyncServerUrls] = useState<SyncServerUrls | null>(
    null,
  )
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

      const storedUrl =
        automergeUrl && isValidAutomergeUrl(automergeUrl) ? automergeUrl : null

      // Finds the stored library in `candidate`, or creates a fresh one when
      // there is nothing stored yet. Reports whether the library was found, so
      // the caller can try a different repo rather than inventing a new doc.
      const bootstrap = async (candidate: Repo) => {
        if (!storedUrl) {
          handleRef.current = candidate.create<RecordingRepoState>({
            recordings: [],
          })
          setAutomergeUrl(handleRef.current.url)
          setRepo(candidate)
          return true
        }

        try {
          // A peer that never answers would otherwise leave `find` pending
          // forever: the websocket adapter reports itself ready a second after
          // construction whether or not it ever connected.
          handleRef.current = await candidate.find(storedUrl, {
            signal: AbortSignal.timeout(FIND_TIMEOUT_MS),
          })
          setRepo(candidate)
          return true
        } catch (findError) {
          console.info('Library not found in this repo', findError)
          return false
        }
      }

      // Without a running embedded server there is nothing to persist to on
      // disk, so keep the legacy IndexedDB store rather than running the session
      // with no persistence at all.
      if (!syncServerUrls.localUrl) {
        const offlineRepo = new Repo({
          storage: new IndexedDBStorageAdapter(),
          network: buildRendererNetwork(syncServerUrls),
        })
        if (!(await bootstrap(offlineRepo))) {
          setError('Your library could not be loaded from this device.')
        }
        return
      }

      // No storage adapter: the embedded sync server persists these documents
      // to the filesystem for us (see syncServer.ts), which keeps the desktop
      // library off the renderer's origin quota. It responds to requests even
      // though its share policy never announces, so `find` works.
      const _repo = new Repo({
        network: buildRendererNetwork(syncServerUrls),
      })

      if (await bootstrap(_repo)) {
        return
      }

      // The server doesn't have the library. That's a pre-TAP-69 install, whose
      // only copy is in this renderer's IndexedDB: run this session on the
      // legacy IndexedDB-backed repo, which announces the library to the server
      // in the background so the next launch finds it on disk. Once this has
      // shipped for a release, the fallback and the IndexedDB dependency can go.
      await _repo.shutdown()
      const legacyRepo = new Repo({
        storage: new IndexedDBStorageAdapter(),
        network: buildRendererNetwork(syncServerUrls),
      })

      if (!(await bootstrap(legacyRepo))) {
        // Neither the server nor IndexedDB has it. Creating a fresh doc here
        // would be indistinguishable from silently losing the library.
        setError('Your library could not be loaded from this device.')
      }
    }
    initialize()
  }, [automergeUrl, setAutomergeUrl, syncServerUrls])

  if (error) {
    return <div>{error}</div>
  }

  if (!repo) {
    return <div>Loading...</div>
  }

  return <App appContextValue={appContextValue} repoContextValue={repo} />
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
