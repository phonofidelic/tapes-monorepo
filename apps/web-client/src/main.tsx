import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  App,
  RecordingRepoState,
  resolveBlobEndpoints,
  useAutomergeUrl,
} from '@tapes-monorepo/core'
import './index.css'
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

// Where this bundle syncs, in precedence order:
//
//   1. VITE_SYNC_SERVER_URL — build-time, the Vercel deploy path.
//   2. `remoteSyncServerUrl` in localStorage — a remote server the user opted
//      into from Settings.
//   3. The Vite dev server (import.meta.env.DEV) — same-origin `/sync`, which
//      the dev server proxies to the Electron host's embedded sync server so a
//      LAN guest gets HMR and sync at once (see vite.config.ts).
//   4. VITE_SERVED_BY_HOST — set when electron-client stages this bundle into
//      its own resources, so the host is serving it and the sync server is on
//      the same origin. That flag is what distinguishes a host-served bundle
//      from a standalone static deploy; both are plain builds otherwise.
//   5. Nothing matched — a standalone deploy with no server to reach. Resolve
//      to undefined and let core run local-only (IndexedDB plus cross-tab
//      BroadcastChannel) instead of retrying an origin nothing listens on.

// A bundle the Electron host serves to LAN guests gets no service worker; the
// plugin is disabled for that build (see vite.config.ts for why). Tear down any
// worker a guest registered from this origin before that was true, so it can't
// keep serving a cached bundle from a host it may no longer be able to reach.
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

const syncServerUrl = resolveSyncServerUrl({
  env: import.meta.env,
  location: window.location,
  storage: window.localStorage,
  token: pairingToken,
})

// Where this bundle sends and fetches recorded audio. Same shape as the sync
// URL chain above: the host's own origin when it is serving us, an explicit
// remote otherwise, and nothing at all for a standalone deploy — in which case
// recordings simply stay in this device's OPFS. More than one can resolve, in
// which case they are tried in order.
const blobEndpoints = resolveBlobEndpoints({
  origin: window.location.origin,
  servedByHost,
  isDev: import.meta.env.DEV,
  remoteSyncServerUrl: syncServerUrl,
  token: pairingToken,
})

if (servedByHost && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations.map((registration) => registration.unregister()),
      ),
    )
    .catch((error) => {
      console.error('Failed to unregister service workers', error)
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
          handleRef.current = await _repo.find(automergeUrl)
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
      />
    )
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <WebClientRoot />
      {!servedByHost && <ShellPrompts />}
    </React.StrictMode>,
  )
}
