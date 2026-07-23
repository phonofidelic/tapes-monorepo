import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App, IpcService, SyncServerInfo } from '@tapes-monorepo/core'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const appContextValue = {
  type: 'electron-client' as const,
  ipc: new IpcService(),
}

function getRemoteSyncServerUrl(): string | undefined {
  // Settings are written by core's SettingsProvider under this key.
  const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as {
    syncServerMode?: string
    remoteSyncServerUrl?: string
  }

  const remoteUrl =
    settings.remoteSyncServerUrl ?? import.meta.env.VITE_SYNC_SERVER_URL

  return settings.syncServerMode === 'remote' ? remoteUrl : undefined
}

function ElectronAppRoot() {
  const [syncServerUrl, setSyncServerUrl] = useState<string | null>(
    () => getRemoteSyncServerUrl() ?? null,
  )

  useEffect(() => {
    if (syncServerUrl) {
      return
    }

    appContextValue.ipc
      .send<SyncServerInfo>('sync:get-server-info')
      .then((info) => {
        if (info.running) {
          setSyncServerUrl(info.url)
          return
        }
        const fallbackUrl = import.meta.env.VITE_SYNC_SERVER_URL
        if (fallbackUrl) {
          setSyncServerUrl(fallbackUrl)
          return
        }
        console.error('Embedded sync server is not running')
      })
  }, [syncServerUrl])

  if (!syncServerUrl) {
    return null
  }

  return <App appContextValue={appContextValue} syncServerUrl={syncServerUrl} />
}

const root = createRoot(rootElement)
root.render(
  <StrictMode>
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100vw',
        userSelect: 'none',
        paddingTop: '32px',
      }}
    >
      <div
        id="titlebar"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '32px',
          zIndex: 999,
        }}
      />
      <ElectronAppRoot />
    </div>
  </StrictMode>,
)
