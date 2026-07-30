import React from 'react'
import { SettingsProvider } from './SettingsContext'
import { AudioPlayerProvider } from './AudioPlayerContext'
import { ViewProvider } from './ViewContext'
import { AppContextProvider, AppContextValue } from './AppContext'
import { Repo } from '@automerge/automerge-repo'
import { RepoContext } from '@automerge/automerge-repo-react-hooks'
import { RecordingStateProvider } from './RecordingContext'
import { BlobProvider } from './BlobContext'
import { PinProvider } from './PinContext'
import type { BlobEndpoint } from '@/blobClient'

export default function Providers({
  values,
  children,
}: {
  values: {
    appContext: AppContextValue
    repoContext: Repo
    blobEndpoint?: BlobEndpoint
  }
  children: React.ReactNode
}) {
  return (
    <AppContextProvider value={values.appContext}>
      <SettingsProvider>
        <RepoContext.Provider value={values.repoContext}>
          <RecordingStateProvider>
            <ViewProvider>
              {/* Pins need the endpoint to prefetch; the player needs pins to
                  know what it must not evict. */}
              <BlobProvider endpoint={values.blobEndpoint}>
                <PinProvider>
                  <AudioPlayerProvider>{children}</AudioPlayerProvider>
                </PinProvider>
              </BlobProvider>
            </ViewProvider>
          </RecordingStateProvider>
        </RepoContext.Provider>
      </SettingsProvider>
    </AppContextProvider>
  )
}
