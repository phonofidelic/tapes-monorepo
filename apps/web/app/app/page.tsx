'use client'

import {
  App,
  AppContextProvider,
  RecordingProvider,
  SettingsProvider,
  ViewProvider,
} from '@tapes-monorepo/core'
import DownloadPrompt from './DownloadPrompt'

export default function AppPage() {
  return (
    <>
      <div className="flex sm:hidden">
        <AppContextProvider value={{ type: 'web' }}>
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
    </>
  )
}
