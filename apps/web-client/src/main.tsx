import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { WebClientAppShell } from './WebClientAppShell'
import { App } from '@tapes-monorepo/core'

if (!window.Worker) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <div className="flex size-full items-center justify-center">
        <p>Your browser does not support web workers</p>
      </div>
    </React.StrictMode>,
  )
} else {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element not found')
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="relative flex h-svh w-screen touch-none flex-col overflow-hidden">
        <WebClientAppShell>
          <App />
        </WebClientAppShell>
      </div>
    </React.StrictMode>,
  )
}
