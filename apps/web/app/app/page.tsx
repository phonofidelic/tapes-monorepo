'use client'

import {
  App,
  AppContextProvider,
  SettingsProvider,
  ViewProvider,
} from '@tapes-monorepo/core'
import DownloadPrompt from './DownloadPrompt'

export default function AppPage() {
  return (
    <>
      <div className="flex sm:hidden">
        <AppContextProvider appType="web">
          <ViewProvider>
            <SettingsProvider>
              <App />
            </SettingsProvider>
          </ViewProvider>
        </AppContextProvider>
      </div>
      <div className="mx-auto hidden h-screen w-screen max-w-screen-sm flex-col items-center justify-center gap-16 sm:flex">
        <DownloadPrompt />
      </div>
    </>
  )
}
