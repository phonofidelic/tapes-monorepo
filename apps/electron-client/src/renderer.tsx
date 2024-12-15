/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, SettingsProvider, ViewProvider } from '@tapes-monorepo/core'
import './index.css'

console.log(
  '👋 This message is being logged by "renderer.ts", included via Vite',
)

// if (process.env.NODE_ENV === 'development') {
//   const head = document.querySelector('head')
//   const script = document.createElement('script')
//   script.src = 'http://localhost:8097'
//   head?.appendChild(script)
// }

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = createRoot(rootElement)
root.render(
  <StrictMode>
    <ViewProvider>
      <SettingsProvider>
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
          <App />
        </div>
      </SettingsProvider>
    </ViewProvider>
  </StrictMode>,
)
