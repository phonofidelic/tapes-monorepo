/*
 * Adapted from:
 * https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/
 */
declare global {
  interface Window {
    api: {
      send(channel: ValidIpcChanel, data: IpcRequest): void
      receive(channel: string, func: (...args: unknown[]) => void): void
    }
  }
}

export type ValidIpcChanel =
  | 'settings:set-default-audio-input-device'
  | 'storage:open-directory-dialog'
  | 'storage:edit-recording'
  | 'storage:delete-recording'
  | 'recorder:start'
  | 'recorder:stop'
  | 'sync:get-server-info'
  | 'sync:set-lan-enabled'
  | 'sync:set-https-enabled'

export type SyncServerInfo = {
  running: boolean
  url: string
  lanUrl?: string
  /** URL of the hosted web-client bundle, when one is being served. */
  webAppUrl?: string
  /** LAN-reachable URL of the hosted web-client bundle. */
  lanWebAppUrl?: string
  port: number
  host: string
}

type IpcRequest = {
  responseChannel?: string
  params?: string[]
  data?: unknown
}

export type IpcResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: unknown
      error: never
    }

export type StopRecordingResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: { filepath: string }
      error: never
    }

export type EditRecordingResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: { filepath: string }
      error: never
    }

type IpcSendArgs =
  | [
      'settings:set-default-audio-input-device',
      IpcRequest & { data: { deviceName: string } },
    ]
  | ['storage:open-directory-dialog']
  | [
      'storage:edit-recording',
      IpcRequest & { data: { filename: string; filepath: string } },
    ]
  | ['storage:delete-recording', IpcRequest & { data: { filepath: string } }]
  | [
      'recorder:start',
      IpcRequest & {
        data: {
          storageLocation: string
          audioChannelCount: number
          audioFormat: string | undefined
        }
      },
    ]
  | ['recorder:stop', IpcRequest]
  | ['sync:get-server-info']
  | ['sync:set-lan-enabled', IpcRequest & { data: { enabled: boolean } }]
  | ['sync:set-https-enabled', IpcRequest & { data: { enabled: boolean } }]
export class IpcService {
  private ipcRenderer?: Window['api']

  private initializeIpcRenderer() {
    if (!window || !window.api) {
      throw new Error(`Unable to require renderer process`)
    }
    this.ipcRenderer = window.api
  }

  public send<T>(...[channel, request = {}]: IpcSendArgs): Promise<T> {
    // If the ipcRenderer is not available try to initialize it
    if (!this.ipcRenderer) {
      this.initializeIpcRenderer()
    }
    // If there's no specific responseChannel, generate one with a timestamp
    if (!request.responseChannel) {
      request.responseChannel = `${channel}:response:${Date.now()}`
    }

    if (!this.ipcRenderer) {
      throw new Error(
        `Unable to send ipc message: ipcRenderer was not initialized.`,
      )
    }

    const ipcRenderer = this.ipcRenderer

    try {
      ipcRenderer.send(channel, request)
    } catch (error) {
      throw new Error(
        `Unable to send ipc message: ${error}. Channel: ${channel}`,
      )
    }

    // This method returns a promise which will be resolved when the response has arrived.
    return new Promise((resolve) => {
      ipcRenderer.receive(request.responseChannel ?? '', (...args: unknown[]) => {
        resolve(args[0] as T)
      })
    })
  }
}
