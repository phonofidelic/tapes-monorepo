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
import { usePlayEventQueue } from '@/usePlayEventQueue'
import type { BlobEndpoint } from '@/blobClient'

/**
 * The player, with its measured play sessions going to the event queue.
 *
 * A component of its own because the queue needs the blob endpoints to know
 * which host owns a play, so the hook has to run below `BlobProvider` — and
 * the player takes the callback as a prop rather than reading a context, so
 * that a shell which does not count plays simply leaves it out.
 */
function CountedPlayback({ children }: { children: React.ReactNode }) {
  const recordPlaySession = usePlayEventQueue()
  return (
    <AudioPlayerProvider onPlaySession={recordPlaySession}>
      {children}
    </AudioPlayerProvider>
  )
}

export default function Providers({
  values,
  children,
}: {
  values: {
    appContext: AppContextValue
    repoContext: Repo
    blobEndpoints?: readonly BlobEndpoint[]
  }
  children: React.ReactNode
}) {
  return (
    <AppContextProvider value={values.appContext}>
      <SettingsProvider>
        <RepoContext.Provider value={values.repoContext}>
          <RecordingStateProvider>
            <ViewProvider>
              {/* Pins need the endpoints to prefetch; the player needs pins to
                  know what it must not evict. */}
              <BlobProvider endpoints={values.blobEndpoints}>
                <PinProvider>
                  <CountedPlayback>{children}</CountedPlayback>
                </PinProvider>
              </BlobProvider>
            </ViewProvider>
          </RecordingStateProvider>
        </RepoContext.Provider>
      </SettingsProvider>
    </AppContextProvider>
  )
}
