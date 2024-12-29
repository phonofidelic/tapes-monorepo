import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@tapes-monorepo/core'
import './index.css'
import DownloadPrompt from './DownloadPrompt'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="flex sm:hidden">
      <App appContextValue={{ type: 'web-client' }} />
    </div>
    <div className="mx-auto hidden h-screen w-screen max-w-screen-sm flex-col items-center justify-center gap-16 sm:flex">
      <DownloadPrompt />
    </div>
  </React.StrictMode>,
)
