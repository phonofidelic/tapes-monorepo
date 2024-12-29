import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, IpcService } from '@tapes-monorepo/core'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const appContextValue = {
  type: 'electron-client' as const,
  ipc: new IpcService(),
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
      <App appContextValue={appContextValue} />
    </div>
  </StrictMode>,
)
