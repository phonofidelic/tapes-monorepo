/**
 * The request/response contract between core and a platform backend.
 *
 * A request carries only its data. Pairing a response with its request is the
 * transport's job, not this type's. Most channels answer with one of the
 * response unions below. A caller reads those to tell a failed read from an
 * empty result.
 */
declare global {
  interface Window {
    api: {
      /**
       * Sends a request and resolves with the main process's answer. Electron
       * pairs the two, so nothing here names a channel to reply on.
       */
      invoke(channel: ValidIpcChanel, data: IpcRequest): Promise<unknown>
      /**
       * Listens for a main-process event. These arrive unprompted and repeat.
       * A request is answered once instead. Returns the unsubscribe.
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

/**
 * Events the main process sends to the renderer.
 *
 * One entry on purpose. The channels above cover everything the renderer asks
 * for. This is only for state that changes on its own.
 */
export type ValidIpcEvent = 'sync:connected-devices'

export type IpcRequest = {
  params?: string[]
  data?: unknown
}

/**
 * The answer from a channel whose success carries nothing the caller reads, or
 * nothing at all.
 */
export type IpcResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data?: unknown
    }

export type StopRecordingResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data: { filepath: string }
    }

export type EditRecordingResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data: { filepath: string }
    }

export type ReadFileResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data: { bytes: Uint8Array; mimeType: string }
    }

/** Descriptor for a recording ingested into the host's blob store. */
export type PutBlobResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data: { hash: string; size: number; mimeType: string; ext: string }
    }

export type HasBlobResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data: { present: boolean; size?: number; mimeType?: string }
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

/**
 * One request/response channel the main process serves.
 *
 * A handler returns the answer. Electron sends it back to the renderer that
 * asked, so nothing here names a channel to reply on. A channel whose outcome
 * the caller must tell apart answers with one of core's response unions. A
 * handler that throws rejects the caller's promise, which is a bug.
 */
export interface IpcChannel {
  name: ValidIpcChanel
  handle(request: IpcRequest): unknown
}
