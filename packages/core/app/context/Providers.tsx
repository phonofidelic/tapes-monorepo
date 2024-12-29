import React from 'react'
import { SettingsProvider } from './SettingsContext'
import { AudioPlayerProvider } from './AudioPlayerContext'
import { ViewProvider } from './ViewContext'
import { AppContextProvider, AppContextValue } from './AppContext'
import { Repo } from '@automerge/automerge-repo'
import { RepoContext } from '@automerge/automerge-repo-react-hooks'
import { RecordingStateProvider } from './RecordingContext'

export default function Providers({
  values,
  children,
}: {
  values: {
    appContext: AppContextValue
    repoContext: Repo
  }
  children: React.ReactNode
}) {
  return (
    <AppContextProvider value={values.appContext}>
      <RepoContext.Provider value={values.repoContext}>
        <RecordingStateProvider>
          <ViewProvider>
            <AudioPlayerProvider>
              <SettingsProvider>{children}</SettingsProvider>
            </AudioPlayerProvider>
          </ViewProvider>
        </RecordingStateProvider>
      </RepoContext.Provider>
    </AppContextProvider>
  )
}
