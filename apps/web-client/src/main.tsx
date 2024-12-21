import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  App,
  AppContextProvider,
  RecordingProvider,
  SettingsProvider,
  ViewProvider,
} from '@tapes-monorepo/core'
import './index.css'
import DownloadPrompt from './DownloadPrompt'

const automergeUrl =
  new URLSearchParams(window.location.search).get('am') ?? undefined

console.log('location.search, automergeUrl', automergeUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="flex sm:hidden">
      <AppContextProvider value={{ type: 'web', automergeUrl }}>
        <RecordingProvider>
          <ViewProvider>
            <SettingsProvider>
              <App />
            </SettingsProvider>
          </ViewProvider>
        </RecordingProvider>
      </AppContextProvider>
    </div>
    <div className="mx-auto hidden h-screen w-screen max-w-screen-sm flex-col items-center justify-center gap-16 sm:flex">
      <DownloadPrompt />
    </div>
  </React.StrictMode>,
)
