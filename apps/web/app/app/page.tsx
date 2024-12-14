import { ViewProvider } from '@tapes-monorepo/core/context/ViewContext'
import { SettingsProvider } from '@tapes-monorepo/core/context/SettingsContext'
import { App } from '@tapes-monorepo/core/App'
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
