import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@tapes-monorepo/core'
import './index.css'
import DownloadPrompt from './DownloadPrompt'

// When the bundle is served from the Electron host, the sync server lives on
// the same origin, so derive the URL from window.location. A build-time
// VITE_SYNC_SERVER_URL (the Vercel deploy path) still takes precedence.
const syncServerUrl =
  import.meta.env.VITE_SYNC_SERVER_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

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
