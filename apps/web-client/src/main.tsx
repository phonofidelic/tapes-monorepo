import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  App,
  RecordingRepoState,
  resolveBlobEndpoints,
  resolveDeviceLabel,
  resolveEventTarget,
  useAutomergeUrl,
} from '@tapes-monorepo/core'
import './index.css'
import { storePairingToken } from './blobAuth'
import ShellPrompts from './ShellPrompts'
import { resolveSyncServerUrl } from './syncServerUrl'
import {
  DocHandle,
  isValidAutomergeUrl,
  NetworkAdapterInterface,
  Repo,
} from '@automerge/automerge-repo'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'

// Where this bundle syncs, in precedence order. Each step is commented in
// syncServerUrl.ts next to the code that takes it.
//
//   1. VITE_SYNC_SERVER_URL, set at build time for the Vercel deploy.
//   2. `remoteSyncServerUrl` in localStorage, chosen by the user in Settings.
//   3. The Vite dev server: same-origin `/sync`, proxied to the Electron host
//      so a LAN guest gets HMR and sync at once (see vite.config.ts).
//   4. VITE_SERVED_BY_HOST: electron-client staged this bundle, so the host
//      serves it and the sync server is on the same origin. That flag is the
//      only difference from a standalone static deploy.
//   5. Nothing matched: a standalone deploy with no server to reach. Core runs
//      local-only (IndexedDB plus cross-tab BroadcastChannel).

const servedByHost = import.meta.env.VITE_SERVED_BY_HOST === 'true'

// The QR/copy link a host shows for pairing carries its token as `pt`. Stash
// it in the settings blob (next to `remoteSyncServerUrl`) and strip it from the
// address bar, so it is not left sitting in history or a shared link.
function capturePairingToken(): string | undefined {
  const settings = JSON.parse(window.localStorage.getItem('settings') ?? '{}')
  const fromQuery = new URLSearchParams(window.location.search).get('pt')
  if (fromQuery) {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, pairingToken: fromQuery }),
    )
    const url = new URL(window.location.href)
    url.searchParams.delete('pt')
    window.history.replaceState({}, '', url)
    return fromQuery
  }
  return typeof settings.pairingToken === 'string'
    ? settings.pairingToken
    : undefined
}

// Read before the sync URL is resolved: a host-served bundle has to present
// this token on the socket upgrade, not just on `/blobs`.
const pairingToken = capturePairingToken()

// Read here for the same reason as the token. The name has to be on the
// socket's upgrade request. It is the user's own name when they set one, and a
// derived "iPhone · Safari" otherwise.
const deviceLabel = resolveDeviceLabel({
  storage: window.localStorage,
  navigator: window.navigator,
})

const syncServerUrl = resolveSyncServerUrl({
  env: import.meta.env,
  location: window.location,
  storage: window.localStorage,
  token: pairingToken,
  deviceLabel,
})

// Where this bundle sends and fetches recorded audio. Same shape as the sync
// URL chain above: the host's own origin when it is serving us, an explicit
// remote otherwise, and nothing at all for a standalone deploy, where
// recordings simply stay in this device's OPFS. More than one can resolve, in
// which case they are tried in order.
const blobEndpoints = resolveBlobEndpoints({
  origin: window.location.origin,
  servedByHost,
  isDev: import.meta.env.DEV,
  remoteSyncServerUrl: syncServerUrl,
  token: pairingToken,
})

// Where this bundle reports plays and reads play counts. One host, not a list.
// A guest's numbers live on the host it is paired with, and no other host can
// answer for it.
const eventTarget = resolveEventTarget({
  origin: window.location.origin,
  servedByHost,
  isDev: import.meta.env.DEV,
  remoteSyncServerUrl: syncServerUrl,
  token: pairingToken,
})

// The host-served bundle runs a service worker whose only job is to add the
// pairing token to `/blobs` requests (src/blobAuthSw.ts). An audio element
// cannot set headers, so without it streaming playback would have to put the
// token in the query string, where the DOM and the host's access log would
// both keep a copy.
//
// The token is written before the worker is registered, so the worker finds it
// on its first fetch. Registration can fail: plain-HTTP LAN mode is not a
// secure context. Those guests go without and buffer whole files instead.
if (servedByHost && 'serviceWorker' in navigator) {
  storePairingToken(pairingToken)
    .then(() => navigator.serviceWorker.register('/blobAuthSw.js'))
    .catch((error) => {
      console.error('Blob auth service worker unavailable', error)
    })
}

if (!window.Worker) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <div className="flex size-full items-center justify-center">
        <p>Your browser does not support web workers</p>
      </div>
    </React.StrictMode>,
  )
} else {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  })

  worker.onmessageerror = (event) => {
    console.log('worker.onmessageerror', event)
  }
  worker.onerror = (event) => {
    console.log('worker.onerror', event)
  }

  // Builds the repo this shell hands to core: IndexedDB for storage, cross-tab
  // BroadcastChannel always, and a websocket to whichever sync server resolved
  // above (if any).
  function WebClientRoot() {
    const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()
    const [repo, setRepo] = useState<Repo | null>(null)
    const handleRef = useRef<DocHandle<unknown> | null>(null)
    const didInitRef = useRef(false)

    useEffect(() => {
      const initialize = async () => {
        // Guard against re-init (StrictMode double-invoke, dep changes). A `repo`
        // state check can't do this: initialize() is async and setRepo lands only
        // at the end, so concurrent runs would each build a Repo and websocket.
        if (didInitRef.current) {
          return
        }
        didInitRef.current = true

        const network: NetworkAdapterInterface[] = [
          new BroadcastChannelNetworkAdapter(),
        ]
        if (syncServerUrl) {
          network.push(new BrowserWebSocketClientAdapter(syncServerUrl))
        }

        const _repo = new Repo({
          storage: new IndexedDBStorageAdapter(),
          network,
        })

        if (automergeUrl && isValidAutomergeUrl(automergeUrl)) {
          handleRef.current = await _repo.find(automergeUrl, {
            signal: AbortSignal.timeout(30 * 1000),
          })
        } else {
          handleRef.current = _repo.create<RecordingRepoState>({
            recordings: [],
          })
          setAutomergeUrl(handleRef.current.url)
        }

        setRepo(_repo)
      }
      initialize()
      // `automergeUrl` changing mid-session (Settings imported a host's
      // document) needs no rebuild here: the adapters are unchanged, and core
      // finds the new document through this same repo. Only the desktop shell
      // rebuilds, because there the url decides which server it talks to.
    }, [automergeUrl, setAutomergeUrl])

    return (
      <App
        appContextValue={{ type: 'web-client', worker }}
        repoContextValue={repo}
        blobEndpoints={blobEndpoints}
        eventTarget={eventTarget}
      />
    )
  }

  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element not found')
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="relative flex h-svh w-screen touch-none flex-col overflow-hidden">
        <WebClientRoot />
        {!servedByHost && <ShellPrompts />}
      </div>
    </React.StrictMode>,
  )
}
