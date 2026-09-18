import { Readable } from 'stream'
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import path from 'path'
import started from 'electron-squirrel-startup'
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer'
import { updateElectronApp } from 'update-electron-app'
import { IpcChannel } from './types'
import { getBlobStore, stopSyncServer } from './syncServer'
import { startSyncServerFromConfig } from './syncServerRuntime'
import { startConnectedDevicesPush } from './connectedDevicesPush'
import { isSyncServerCert } from './certManager'
import { hashFromTapesBlobUrl } from './protocolUrls'

// The scheme must be declared before the app is ready. Electron reads this
// list once, on startup, so it cannot live inside `MainWindow`.
//
// `standard` gives the scheme real origin and path parsing, which a
// hash-shaped authority takes cleanly. `stream` and `supportFetchAPI` are what
// audio needs: chunked responses with range behavior, and `fetch()`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tapes-blob',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
])

// Not under test: the updater would reach out to GitHub on launch and could
// swap the very build the e2e suite is driving out from under it.
if (!process.env.TAPES_E2E) {
  updateElectronApp()
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit()
}

export class MainWindow {
  private window: BrowserWindow | null = null

  public init(ipcChannels: IpcChannel[]) {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on('ready', () => {
      this.startSyncServer()
      this.registerCustomProtocols()
      this.createWindow()
    })
    app.on('window-all-closed', this.onWindowAllClosed)
    app.on('activate', this.onActivate)
    app.on('will-quit', this.onWillQuit)
    this.registerSyncServerCertTrust()
    this.registerIpcChannels(ipcChannels)
    this.startConnectedDevicesPush()
  }

  // When the embedded sync server runs over HTTPS, the host's own renderer
  // connects to it at `wss://127.0.0.1` with a certificate our own root issued.
  // Trust any certificate that root signed, so the loopback connection survives
  // a re-issued leaf without disabling verification for anything else.
  private registerSyncServerCertTrust() {
    app.on(
      'certificate-error',
      (event, _webContents, _url, _error, cert, callback) => {
        if (cert.data && isSyncServerCert(cert.data)) {
          event.preventDefault()
          callback(true)
          return
        }
        callback(false)
      },
    )
  }

  private async createWindow() {
    this.window = new BrowserWindow({
      title: 'Tapes',
      show: false,
      width: 408,
      height: 552,
      maxWidth: 639,
      minWidth: 408,
      minHeight: 552,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    })

    this.window.once('ready-to-show', () => {
      if (this.window) {
        this.window.show()
      }
    })

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      this.window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    } else {
      this.window.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      )
    }

    if (process.env.NODE_ENV === 'development') {
      try {
        await installExtension(REACT_DEVELOPER_TOOLS)
      } catch (error) {
        console.error('Failed to install React Developer Tools:', error)
      }
      this.window.webContents.openDevTools()
    }
  }

  private onWindowAllClosed() {
    // Quit when all windows are closed, except on macOS. There, it's common
    // for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q.
    if (process.platform !== 'darwin') {
      app.quit()
    }
  }

  private onActivate() {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      this.createWindow()
    }
  }

  private stopConnectedDevicesPush?: () => void

  /**
   * Forwards connection changes to the renderer as they happen.
   *
   * Subscribed once at startup rather than per server. The LAN and HTTPS
   * toggles both restart the sync server, and a subscription tied to a running
   * one would go quiet after the first toggle.
   */
  private startConnectedDevicesPush() {
    this.stopConnectedDevicesPush = startConnectedDevicesPush(
      () => this.window?.webContents,
    )
  }

  private registerIpcChannels(ipcChannels: IpcChannel[]) {
    ipcMain.setMaxListeners(1)

    ipcChannels.forEach((channel) =>
      ipcMain.on(channel.name, (event, request) =>
        channel.handle(event, request),
      ),
    )
  }

  private syncServerStopped = false

  private async startSyncServer() {
    try {
      await startSyncServerFromConfig()
    } catch (error) {
      console.error('Failed to start sync server:', error)
    }
  }

  private onWillQuit = (event: Electron.Event) => {
    // Flush the Automerge repo to disk before the process exits.
    if (this.syncServerStopped) {
      return
    }
    event.preventDefault()
    this.syncServerStopped = true
    this.stopConnectedDevicesPush?.()
    stopSyncServer()
      .catch((error) => {
        console.error('Failed to stop sync server:', error)
      })
      .finally(() => {
        app.exit(0)
      })
  }

  private registerCustomProtocols() {
    // Content-addressed audio, served straight out of the blob store.
    protocol.handle('tapes-blob', async (request) => {
      const hash = hashFromTapesBlobUrl(request.url)
      const store = getBlobStore()
      if (!store) {
        return new Response('Blob store unavailable', { status: 503 })
      }

      const meta = await store.stat(hash)
      if (!meta) {
        return new Response('Unknown blob', { status: 404 })
      }

      return new Response(
        Readable.toWeb(store.read(hash)) as ReadableStream<Uint8Array>,
        {
          headers: {
            'Content-Type': meta.mimeType,
            'Content-Length': String(meta.size),
          },
        },
      )
    })
  }
}
