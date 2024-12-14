import { app, BrowserWindow, ipcMain, IpcMainEvent } from 'electron'
import path from 'path'
import started from 'electron-squirrel-startup'
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit()
}

type IpcRequest = {
  responseChannel?: string
  params?: string[]
  data?: unknown
}

type IpcChannel = {
  name: string
  handle(event: IpcMainEvent, request: IpcRequest): void
}

export class MainWindow {
  private window: BrowserWindow | null = null

  public init(ipcChannels: IpcChannel[]) {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on('ready', this.createWindow)
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
      // this.window.loadURL('http://localhost:3000/app')
    } else {
      this.window.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      )
      // this.window.loadURL('https://tapes-monorepo-web.vercel.app')
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
    ipcChannels.forEach((channel) =>
      ipcMain.on(channel.name, (event, request) =>
        channel.handle(event, request),
      ),
    )
  }
}
