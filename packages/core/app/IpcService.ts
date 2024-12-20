/*
 * Adapted from:
 * https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/
 */
declare global {
  interface Window {
    api: {
      send(channel: string, data: any): void
      receive(channel: string, data: any): void
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

export class IpcService {
  private ipcRenderer?: {
    send(channel: ValidIpcChanel, data: any): void
    receive(channel: string, data: any): void
  }

  private initializeIpcRenderer() {
    if (!window || !window.api) {
      throw new Error(`Unable to require renderer process`)
    }
    this.ipcRenderer = window.api
  }

  public send<T>(
    channel: ValidIpcChanel,
    request: IpcRequest = {},
  ): Promise<T> {
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
      ipcRenderer.receive(request.responseChannel ?? '', (response: any) => {
        resolve(response)
      })
    })
  }
}
