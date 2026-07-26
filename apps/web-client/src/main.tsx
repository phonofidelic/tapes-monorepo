import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@tapes-monorepo/core'
import './index.css'
import DownloadPrompt from './DownloadPrompt'

// The sync socket always lives at `/sync` on the same origin as this bundle.
// When the Electron host serves the bundle it accepts the upgrade on any path
// (its WebSocketServer is attached to the whole http server, not a route), and
// in development the bundle is served by this package's own Vite dev server
// (for HMR), which proxies `/sync` back to that host (see vite.config.ts). A
// build-time VITE_SYNC_SERVER_URL (the Vercel deploy path) takes precedence.
const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
const syncServerUrl =
  import.meta.env.VITE_SYNC_SERVER_URL ??
  `${scheme}://${window.location.host}/sync`

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
