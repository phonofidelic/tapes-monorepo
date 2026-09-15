/*
 * Adapted from:
 * https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/
 */
declare global {
  interface Window {
    api: {
      send(channel: ValidIpcChanel, data: IpcRequest): void
      receive(channel: string, func: (...args: unknown[]) => void): void
      /**
       * Listens for a main-process event. Unlike `receive`, which waits for the
       * one response to a request this renderer made, these arrive unprompted
       * and repeatedly. Returns the unsubscribe.
       */
      subscribe(
        event: ValidIpcEvent,
        func: (...args: unknown[]) => void,
      ): () => void
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
  | 'sync:get-connected-devices'
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
  /**
   * SHA-256 of the host's root certificate, in colon-separated pairs, when the
   * sync server is running over TLS. Not a secret: unlike `pairingToken` it
   * grants nothing, and it is published in the pairing link on purpose.
   */
  rootCertFingerprint?: string
  port: number
  host: string
}

/**
 * Events the main process pushes to the renderer, unasked.
 *
 * Deliberately one entry. The request/response surface above covers everything
 * the renderer pulls; this exists only for state that changes on its own, and
 * generalising it into an event bus for a single consumer would buy nothing.
 */
export type ValidIpcEvent = 'sync:connected-devices'

/**
 * One device connected to this host's sync server right now.
 *
 * Mirrors the host-side registry's shape, the way `SyncServerInfo` mirrors the
 * server's. Core never constructs one; it only renders what the host sends.
 */
export type SyncConnection = {
  /** Stable for the life of the connection. Not a device identity. */
  id: string
  /**
   * The name the guest gave on the handshake, already sanitized. Undefined
   * when it sent nothing usable, so the UI picks what to show instead.
   */
  label?: string
  /** Remote address of the socket, for telling same-named devices apart. */
  address?: string
  /** Epoch milliseconds, for "connected 3 minutes ago". */
  connectedAt: number
  /** This host's own window rather than a guest. */
  self: boolean
}

/**
 * The connected-device list, or the reason there isn't one.
 *
 * A union rather than a bare array on purpose. An empty array means the host
 * asked its registry and nobody is connected; a failure means it could not
 * ask. Those look identical to a user shown a blank panel and mean opposite
 * things, so the caller has to handle them apart — see TAP-88, where a toggle
 * that returned nothing failed silently.
 */
export type GetConnectedDevicesResponse =
  | {
      success: false
      data: never
      error: Error
    }
  | {
      success: true
      data: { connections: SyncConnection[] }
      error: never
    }

/**
 * The payload of a `sync:connected-devices` event: the whole new list, not a
 * delta. A renderer that misses one is corrected by the next.
 */
export type ConnectedDevicesEvent = { connections: SyncConnection[] }

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
 * The host's own playback numbers, read from its aggregate store.
 *
 * A failure means the numbers are unavailable. An empty list means nothing has
 * been played. The two are not the same answer.
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
  | ['sync:get-connected-devices']
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

  /**
   * Listens for a main-process event and returns the unsubscribe.
   *
   * `send` is a question with one answer; this is a subscription to state that
   * changes on its own. Nothing here resolves or rejects, so a caller waiting
   * for a first value must ask for it with `send` as well — subscribe first,
   * then request the snapshot, or a change landing between the two is lost.
   */
  public subscribe<T>(
    event: ValidIpcEvent,
    listener: (payload: T) => void,
  ): () => void {
    if (!this.ipcRenderer) {
      this.initializeIpcRenderer()
    }

    if (!this.ipcRenderer) {
      throw new Error(
        `Unable to subscribe to ipc event: ipcRenderer was not initialized.`,
      )
    }

    return this.ipcRenderer.subscribe(event, (...args: unknown[]) => {
      listener(args[0] as T)
    })
  }
}
