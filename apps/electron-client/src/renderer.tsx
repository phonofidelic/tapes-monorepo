import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  App,
  IpcService,
  SyncServerInfo,
  resolveBlobEndpoints,
  resolveEventTarget,
  sameEventTarget,
  subscribeToSettingsChange,
  useAutomergeUrl,
  type BlobEndpoint,
  type EventHost,
} from '@tapes-monorepo/core'
import './index.css'
import { DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import {
  bootstrapRendererRepo,
  isSyncSetting,
  readSyncSettings,
  rendererRepoKey,
  resolveSyncServerUrls,
  sameBlobEndpoints,
  sameSyncServerUrls,
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
  const [blobEndpoints, setBlobEndpoints] = useState<BlobEndpoint[]>([])
  const [eventTarget, setEventTarget] = useState<EventHost | undefined>()
  const [repo, setRepo] = useState<Repo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<DocHandle<unknown> | null>(null)
  const repoRef = useRef<Repo | null>(null)
  const appliedKeyRef = useRef<string | null>(null)
  const generationRef = useRef(0)

  // The embedded server's url only arrives over IPC, and the repo must be built
  // with its adapters already in place: `Repo.find` waits for the network to be
  // ready and then requests the doc, so a repo built before the url resolves
  // would have no peer to ask and report the library as unavailable.
  //
  // This runs again on every sync-settings write, because the Settings UI that
  // makes those writes lives inside `App`, below this component, and the server
  // it points us at is exactly what the repo is built around.
  useEffect(() => {
    let unmounted = false

    const resolve = async () => {
      try {
        const info = await appContextValue.ipc.send<SyncServerInfo>(
          'sync:get-server-info',
        )
        if (unmounted) {
          return
        }
        const settings = readSyncSettings(localStorage)
        const urls = resolveSyncServerUrls({
          settings,
          serverInfo: info,
          envSyncServerUrl: import.meta.env.VITE_SYNC_SERVER_URL,
        })
        if (!urls.localUrl) {
          console.error(
            'Embedded sync server is not running: recordings made in this session will not be stored on disk',
          )
        }
        // Identity is what drives the rebuild below, so an unchanged resolution
        // has to stay the same object: otherwise every settings write would
        // tear down working sockets to build the same repo again.
        setSyncServerUrls((current) =>
          sameSyncServerUrls(current, urls) ? current : urls,
        )
        // Recorded audio goes to the embedded server's own HTTP surface, which
        // it advertises alongside the sync socket. In remote mode this app also
        // syncs with a server it does not host, so it can hold docs whose bytes
        // only that server has ever seen: resolve it as a second endpoint to
        // fall back to rather than 404ing against ourselves.
        const endpoints = resolveBlobEndpoints({
          syncServerInfo: info,
          remoteSyncServerUrl: urls.remoteUrl,
          token: settings.pairingToken,
        })
        setBlobEndpoints((current) =>
          sameBlobEndpoints(current, endpoints) ? current : endpoints,
        )
        // Playback numbers resolve to one host, not a list. In remote mode
        // that is the server this app is a guest of — reading its own embedded
        // store instead would report zeros for a library whose plays all went
        // elsewhere, which is TAP-74's failure in a second place.
        const target = resolveEventTarget({
          syncServerInfo: info,
          remoteSyncServerUrl: urls.remoteUrl,
          token: settings.pairingToken,
        })
        setEventTarget((current) =>
          sameEventTarget(current, target) ? current : target,
        )
      } catch (ipcError) {
        console.error('Failed to reach the embedded sync server', ipcError)
        // Only fatal before there is anything to run on. A failed re-resolve
        // mid-session leaves the current repo connected, and replacing the app
        // with an error would take the Settings UI away with it.
        if (!unmounted && !repoRef.current) {
          setError('Could not reach the local sync server.')
        }
      }
    }

    resolve()
    const unsubscribe = subscribeToSettingsChange((key) => {
      if (isSyncSetting(key)) {
        resolve()
      }
    })

    return () => {
      unmounted = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!syncServerUrls) {
      return
    }

    const storedUrl =
      automergeUrl && isValidAutomergeUrl(automergeUrl) ? automergeUrl : null
    const key = rendererRepoKey(storedUrl, syncServerUrls)
    // Guard against re-init (StrictMode double-invoke, a re-resolution that
    // landed on the same servers). A `repo` state check can't do this:
    // initialize() is async and setRepo lands only at the end, so concurrent
    // runs would each build a Repo and websocket.
    if (appliedKeyRef.current === key) {
      return
    }
    appliedKeyRef.current = key
    const generation = ++generationRef.current

    const initialize = async () => {
      const result = await bootstrapRendererRepo({
        storedUrl,
        urls: syncServerUrls,
        createStorage: () => new IndexedDBStorageAdapter(),
      })

      // Settings changed again while this was in flight. Drop what we built
      // rather than letting a superseded repo win the race.
      if (generation !== generationRef.current) {
        if (result.status === 'ready') {
          await result.repo.shutdown()
        }
        return
      }

      if (result.status === 'unavailable') {
        if (repoRef.current) {
          // Mid-session: keep the repo that is working rather than replacing
          // the whole app — the Settings UI included — with an error the user
          // would have no way to act on. Clearing the key lets the next write
          // to these settings try again.
          console.error(
            'The configured sync server does not have this library; staying on the current one',
          )
          appliedKeyRef.current = null
          return
        }
        // On first load, creating a fresh doc here would be indistinguishable
        // from silently losing the library.
        setError('Your library could not be loaded from this device.')
        return
      }

      const previous = repoRef.current
      repoRef.current = result.repo
      handleRef.current = result.handle
      if (result.createdUrl) {
        setAutomergeUrl(result.createdUrl)
        // `useAutomergeUrl` re-reads localStorage on every render, so record
        // the url we just stored: otherwise the next render computes a
        // different key and rebuilds the repo we have only just created.
        appliedKeyRef.current = rendererRepoKey(
          result.createdUrl,
          syncServerUrls,
        )
      }
      setError(null)
      setRepo(result.repo)

      // Tell the host which library this is. It has no other way to know: the
      // url lives in this renderer's localStorage, and every other doc url the
      // host sees over IPC names a single recording. Without it the blob GC
      // cannot tell a referenced object from an orphan. Best-effort, and
      // `send` can throw synchronously when there is no ipcRenderer at all.
      try {
        void appContextValue.ipc
          .send('library:announce', { data: { url: result.handle.url } })
          .catch((error) =>
            console.info('Could not announce the library to the host', error),
          )
      } catch (error) {
        console.info('Could not announce the library to the host', error)
      }

      // Close the superseded sockets only once the new repo is in place, so
      // the swap never leaves the app with no peer at all.
      if (previous) {
        await previous.shutdown()
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

  return (
    <App
      appContextValue={appContextValue}
      repoContextValue={repo}
      blobEndpoints={blobEndpoints}
      eventTarget={eventTarget}
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
