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
import { AggregatesProvider } from './AggregatesContext'
import { usePlayEventQueue } from '@/usePlayEventQueue'
import type { BlobEndpoint } from '@/blobClient'
import type { EventHost } from '@/eventTarget'

/**
 * The player, with its measured play sessions going to the event queue. A
 * component of its own because the queue needs the blob endpoints to know
 * which host owns a play, so the hook must run below `BlobProvider`. The
 * player takes the callback as a prop rather than reading a context, so a
 * shell that does not count plays leaves it out.
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
    eventTarget?: EventHost
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
                  {/* Inside the app context, which supplies the electron ipc
                      service. Around the player, so a finished play can ask
                      for the numbers again. */}
                  <AggregatesProvider target={values.eventTarget}>
                    <CountedPlayback>{children}</CountedPlayback>
                  </AggregatesProvider>
                </PinProvider>
              </BlobProvider>
            </ViewProvider>
          </RecordingStateProvider>
        </RepoContext.Provider>
      </SettingsProvider>
    </AppContextProvider>
  )
}
