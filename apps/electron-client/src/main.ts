import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
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
      const url = request.url.replace('tapes://', 'file://')
      // const basename = path.basename(url);
      // const filePath =
      //   process.env.NODE_ENV === 'development'
      //   ? path.join(app.getAppPath(), 'Data', basename)
      //     : path.join(process.resourcesPath, 'Data', basename)
      // callback(filePath);
      const response = await net.fetch(url)
      console.log('*** tapes fetch response:', response)

      if (!response.body) {
        throw new Error('No content-type header')
      }

      // const streamResults = await response.body.getReader().read()

      // const dataUrl = `data:${response.headers.get('content-type')};base64,${Buffer.from(streamResults.value ?? '').toString('base64')}`
      // // console.log('*** dataUrl:', dataUrl)

      // return Buffer.from(streamResults.value ?? '')
      // return new Response(url)
      return response
    })
  }
}
