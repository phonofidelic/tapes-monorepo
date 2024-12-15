'use client'

import { App, SettingsProvider, ViewProvider } from '@tapes-monorepo/core'
import DownloadPrompt from './DownloadPrompt'

export default function AppPage() {
  return (
    <>
      <div className="flex: sm:hidden">
        <ViewProvider>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </ViewProvider>
      </div>
      <div className="mx-auto hidden size-full max-w-screen-sm flex-col items-center justify-center gap-16 sm:flex">
        <DownloadPrompt />
      </div>
    </>
  )
}
