import crypto from 'crypto'
import { copyFile } from 'fs/promises'
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import path from 'path'
import started from 'electron-squirrel-startup'
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer'
import { updateElectronApp } from 'update-electron-app'
import { IpcChannel } from './types'

updateElectronApp()

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
      this.registerCustomProtocols()
      this.createWindow()
    })
    app.on('window-all-closed', this.onWindowAllClosed)
    app.on('activate', this.onActivate)
    this.registerIpcChannels(ipcChannels)
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

  private registerIpcChannels(ipcChannels: IpcChannel[]) {
    ipcMain.setMaxListeners(1)

    ipcChannels.forEach((channel) =>
      ipcMain.on(channel.name, (event, request) =>
        channel.handle(event, request),
      ),
    )
  }

  private registerCustomProtocols() {
    protocol.handle('tapes', async (request) => {
      const decodedUrl = decodeURI(request.url)
      const filepath = decodedUrl.replace('tapes://', '')

      const filename = crypto
        .createHash('sha256')
        .update(filepath)
        .digest('hex')
      const extension = path.extname(filepath)

      await copyFile(
        filepath,
        path.resolve(app.getAppPath(), 'cache', filename + extension),
      )

      return Response.redirect(
        `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/cache/${filename + extension}`,
      )
    })
  }
}
