import {
  Repo,
  DocHandle,
  NetworkAdapterInterface,
  isValidAutomergeUrl,
} from '@automerge/automerge-repo'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import {
  RecordingRepoState,
  ErrorBoundary,
  Providers,
  ScreenLoader,
  resolveBlobEndpoints,
  resolveDeviceLabel,
  resolveEventTarget,
  readAutomergeUrl,
  writeAutomergeUrl,
} from '@tapes-monorepo/core'
import { use, Suspense } from 'react'
import { resolveSyncServerUrl } from './syncServerUrl'
import { storePairingToken } from './blobAuth'
import ShellPrompts from './ShellPrompts'
import { Button } from '@tapes-monorepo/ui'

/**
 * `VITE_SERVED_BY_HOST === 'true'` means the electron-client staged this bundle,
 * so the host serves it and the sync server is on the same origin.
 * This flag is the only difference from a standalone static deploy.
 */
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

const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
})

type InitializeRepoParams = {
  syncServerUrl: string | undefined
}

type InitializeRepoResult = { repo: Repo }

// Builds the repo this shell hands to core: IndexedDB for storage, cross-tab
// BroadcastChannel always, and a websocket to whichever sync server resolved.
async function initializeRepo({
  syncServerUrl,
}: InitializeRepoParams): Promise<InitializeRepoResult> {
  const network: NetworkAdapterInterface[] = [
    new BroadcastChannelNetworkAdapter(),
  ]
  if (syncServerUrl) {
    network.push(new BrowserWebSocketClientAdapter(syncServerUrl))
  }

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter(),
    network,
  })

  const automergeUrl = readAutomergeUrl()
  let handle: DocHandle<unknown> | null
  if (automergeUrl && isValidAutomergeUrl(automergeUrl)) {
    handle = await repo.find(automergeUrl, {
      signal: AbortSignal.timeout(30 * 1000),
    })
  } else {
    handle = repo.create<RecordingRepoState>({
      recordings: [],
    })
  }

  writeAutomergeUrl(handle.url)
  return { repo }
}

const cache = new Map<string, Promise<InitializeRepoResult>>()

function initializeRepoCached({
  syncServerUrl,
}: InitializeRepoParams): Promise<InitializeRepoResult> {
  const cacheKey = `${syncServerUrl}`
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, initializeRepo({ syncServerUrl }))
  }
  return cache.get(cacheKey)!
}

function WithWebClientContextProviders({
  children,
}: {
  children: React.ReactNode
}) {
  const { repo } = use(
    initializeRepoCached({
      syncServerUrl,
    }),
  )

  return (
    <Providers
      values={{
        appContext: { type: 'web-client' as const, worker },
        repoContext: repo,
        blobEndpoints,
        eventTarget,
      }}
    >
      {children}
      {!servedByHost && <ShellPrompts />}
    </Providers>
  )
}

export function WebClientAppShell({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <ScreenLoader message={'Something went wrong'}>
          <Button
            className="border-subtle text-foreground border p-1 px-2"
            onClick={() => window.location.reload()}
          >
            {' '}
            Reload
          </Button>
        </ScreenLoader>
      }
    >
      <Suspense fallback={<ScreenLoader message="Loading..." />}>
        <WithWebClientContextProviders>
          {children}
        </WithWebClientContextProviders>
      </Suspense>
    </ErrorBoundary>
  )
}
