import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from '@tapes-monorepo/core'
import { ElectronClientAppShell } from './ElectronClientAppShell'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = createRoot(rootElement)
root.render(
  <StrictMode>
    <div className="relative flex h-screen w-screen flex-col overflow-hidden pt-8 select-none">
      <div id="titlebar" className="fixed top-0 left-0 z-999 h-8 w-full" />
      <ElectronClientAppShell>
        <App />
      </ElectronClientAppShell>
    </div>
  </StrictMode>,
)
