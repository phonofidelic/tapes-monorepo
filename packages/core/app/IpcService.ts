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
  | 'storage:read-file'
  | 'recorder:start'
  | 'recorder:stop'
  | 'sync:get-server-info'
  | 'sync:set-lan-enabled'
  | 'sync:set-https-enabled'
  | 'blob:put-file'
  | 'blob:has'
  | 'blob:cache-put'
  | 'library:announce'
  | 'events:get-aggregates'

export type SyncServerInfo = {
  running: boolean
  url: string
  lanUrl?: string
  /** URL of the hosted web-client bundle, when one is being served. */
  webAppUrl?: string
  /** LAN-reachable URL of the hosted web-client bundle. */
  lanWebAppUrl?: string
  /** Origin serving `/blobs`, when the host has a blob store configured. */
  blobBaseUrl?: string
  /** LAN-reachable origin serving `/blobs`. */
  lanBlobBaseUrl?: string
  /**
   * Bearer token for `/blobs` and the sync socket. Never log this object
   * wholesale.
   */
  pairingToken?: string
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

export type ReadFileResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: { bytes: Uint8Array; mimeType: string }
      error: never
    }

/** Descriptor for a recording ingested into the host's blob store. */
export type PutBlobResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: { hash: string; size: number; mimeType: string; ext: string }
      error: never
    }

export type HasBlobResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: { present: boolean; size?: number; mimeType?: string }
      error: never
    }

/**
 * The host's own playback numbers, read straight off its aggregate store.
 *
 * `success: false` is how "this host has no aggregates" arrives, and it is not
 * the same answer as an empty list: one means the numbers are unavailable, the
 * other that nothing has been played.
 */
export type GetAggregatesResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: {
        aggregates: {
          recordingUrl: string
          plays: number
          averageCompletion: number
        }[]
        generatedAt: string
      }
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
  | [
      'storage:delete-recording',
      // `filepath` is absent for a recording this device never made, `hash`
      // for a legacy doc that predates the blob store; deleting has to cope
      // with either being missing.
      IpcRequest & {
        data: { filepath?: string; hash?: string; docUrl?: string }
      },
    ]
  | ['storage:read-file', IpcRequest & { data: { filepath: string } }]
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
  | [
      'blob:put-file',
      IpcRequest & { data: { filepath: string; docUrl: string } },
    ]
  | ['blob:has', IpcRequest & { data: { hash: string } }]
  | ['library:announce', IpcRequest & { data: { url: string } }]
  | ['events:get-aggregates']
  | [
      'blob:cache-put',
      IpcRequest & {
        data: {
          hash: string
          mimeType: string
          docUrl: string
          bytes: Uint8Array
        }
      },
    ]
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
      ipcRenderer.receive(
        request.responseChannel ?? '',
        (...args: unknown[]) => {
          resolve(args[0] as T)
        },
      )
    })
  }
}
