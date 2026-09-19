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
       * Listens for a main-process event. These arrive unprompted and repeat.
       * A response listener fires once instead. Returns the unsubscribe.
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
 * Events the main process sends to the renderer.
 *
 * One entry on purpose. The channels above cover everything the renderer asks
 * for. This is only for state that changes on its own.
 */
export type ValidIpcEvent = 'sync:connected-devices'

/**
 * One device connected to this host's sync server.
 *
 * Mirrors the shape the host's connection registry keeps. Core only renders
 * these. It never builds one.
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
 * The connected-device list, or the reason there is none.
 *
 * A union rather than a bare array. An empty array means the host read its
 * registry and nobody is connected. A failure means it could not read it. Both
 * show as a blank panel, so callers must tell them apart.
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

export class GetConnectedDevicesError extends Error {
  constructor() {
    super('Could not get connected devices')
  }
}

/**
 * The payload of a connected-devices event. It carries the whole new list
 * rather than a delta, so a renderer that misses one recovers on the next.
 */
export type ConnectedDevicesEvent = { connections: SyncConnection[] }

export type IpcRequest = {
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

export type IpcSendArgs =
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

export interface IpcService {
  send<T>(...[channel, request]: IpcSendArgs): Promise<T>
  subscribe<T>(event: ValidIpcEvent, listener: (payload: T) => void): () => void
}
