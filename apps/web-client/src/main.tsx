import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@tapes-monorepo/core'
import './index.css'
import DownloadPrompt from './DownloadPrompt'
import { resolveSyncServerUrl } from './syncServerUrl'

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
const syncServerUrl = resolveSyncServerUrl({
  env: import.meta.env,
  location: window.location,
  storage: window.localStorage,
})

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

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <div className="flex sm:hidden">
        <App
          appContextValue={{ type: 'web-client', worker }}
          syncServerUrl={syncServerUrl}
        />
      </div>
      <div className="mx-auto hidden h-screen w-screen max-w-screen-sm flex-col items-center justify-center gap-16 sm:flex">
        <DownloadPrompt />
      </div>
    </React.StrictMode>,
  )
}
