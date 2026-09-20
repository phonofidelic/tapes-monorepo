/**
 * The recording worker. Owns the OPFS files behind the web client: recordings
 * this device made live flat in the OPFS root under uuid names, and blobs
 * fetched from the sync host live in `blobs/` under their content hash.
 *
 * Messages arrive from core as `{ type, payload }`. Every payload carries a
 * `requestId`, and every handler replies through `respond`, which echoes it.
 * That is what lets core's `callWorker` match a reply to its request. The one
 * exception is `recorder:write`, which sends no reply at all.
 *
 * A request always gets an answer, including one this file fails to handle:
 * `callWorker` settles on the reply and on nothing else, so a silent handler
 * hangs its caller for the life of the page.
 */
export {}

declare global {
  interface DedicatedWorkerGlobalScope {
    fileHandle: FileSystemFileHandle | null
    accessHandle: FileSystemSyncAccessHandle | null
  }
}

type EventData =
  | {
      type: 'recorder:start'
      payload: {
        audioFormat: 'webm' | 'mp3'
        audioInputDeviceId: string
        requestId: string
      }
    }
  | {
      type: 'recorder:write'
      payload: {
        chunk: Blob
      }
    }
  | {
      type: 'recorder:stop'
      payload: {
        requestId: string
      }
    }
  | {
      type: 'storage:get'
      payload: {
        filename: string
        requestId: string
      }
    }
  | {
      type: 'storage:read-bytes'
      payload: {
        filename: string
        requestId: string
      }
    }
  | {
      type: 'storage:get-file'
      payload: {
        filename: string
        requestId: string
      }
    }
  | {
      type: 'blob:put'
      payload: {
        hash: string
        bytes: ArrayBuffer
        requestId: string
      }
    }
  | {
      type: 'blob:get'
      payload: {
        hash: string
        mimeType: string
        requestId: string
      }
    }
  | {
      type: 'blob:has'
      payload: {
        hash: string
        requestId: string
      }
    }
  | {
      type: 'blob:delete'
      payload: {
        hash: string
        requestId: string
      }
    }

/**
 * Blobs fetched from the sync host are cached here, keyed by content hash, so
 * a guest can replay what it has already played with the host unreachable.
 * Kept in a subdirectory so it never collides with recording files, which live
 * flat in the OPFS root under their own uuid names.
 */
const BLOB_CACHE_DIR = 'blobs'

const blobCacheDirectory = () =>
  navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle(BLOB_CACHE_DIR, { create: true }))

// `self` is typed as the base WorkerGlobalScope; assert to the augmented
// DedicatedWorkerGlobalScope (with fileHandle/accessHandle) declared above.
const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope
ctx.fileHandle = null
ctx.accessHandle = null

onmessage = async (event) => {
  const { type, payload }: EventData = event.data
  // Read off the raw message rather than the narrowed payload: this has to
  // work for a message type the switch below does not know.
  const requestId = (event.data as { payload?: { requestId?: string } }).payload
    ?.requestId

  try {
    switch (type) {
      case 'recorder:start': {
        const { audioFormat, audioInputDeviceId, requestId } = payload
        console.log('recorder:start', { audioFormat, audioInputDeviceId })
        try {
          const root = await navigator.storage.getDirectory()
          const fileHandle = await root.getFileHandle(
            `${crypto.randomUUID()}.${audioFormat}`,
            {
              create: true,
            },
          )
          ctx.fileHandle = fileHandle
          ctx.accessHandle = await fileHandle.createSyncAccessHandle()

          respond('recorder:start', requestId, true, {
            filename: fileHandle.name,
          })
        } catch (error) {
          console.error('error:', error)
          respond('recorder:start', requestId, false, undefined, error)
        }

        break
      }
      case 'recorder:write': {
        // The one handler that never replies. Chunks arrive from a
        // `dataavailable` listener that has nothing to wait for, and the last
        // one lands after the recording has already been stopped.
        const { chunk } = payload as { chunk: Blob }
        if (ctx.accessHandle) {
          try {
            ctx.accessHandle.write(await chunk.arrayBuffer())
            ctx.accessHandle.flush()
            ctx.accessHandle.close()
            ctx.accessHandle = null
          } catch (error) {
            console.error('error writing to file:', error)
          }
        }
        break
      }
      case 'recorder:stop': {
        const { requestId } = payload
        if (ctx.accessHandle) {
          ctx.accessHandle.flush()
        }

        respond('recorder:stop', requestId, true)
        break
      }
      case 'storage:get': {
        const { filename, requestId } = payload
        try {
          const root = await navigator.storage.getDirectory()
          const handle = await root.getFileHandle(filename)
          const accessHandle = await handle.createSyncAccessHandle()
          const fileSize = accessHandle.getSize()
          const buffer = new DataView(new ArrayBuffer(fileSize))
          accessHandle.read(buffer, { at: 0 })

          const blob = new Blob([buffer], { type: 'audio/mp4' })
          respond('storage:get', requestId, true, {
            url: URL.createObjectURL(blob),
            blob,
          })
          accessHandle.close()
        } catch (error) {
          console.error('error, event:', error)
          respond('storage:get', requestId, false, undefined, error)
        }
        break
      }
      case 'storage:read-bytes': {
        // Was how the recorder got bytes to embed in the Automerge doc. Nothing
        // in core calls it now that audio is uploaded out of band via
        // `storage:get-file`; kept until the legacy read path is retired.
        const { filename, requestId } = payload
        try {
          const root = await navigator.storage.getDirectory()
          const handle = await root.getFileHandle(filename)
          const accessHandle = await handle.createSyncAccessHandle()
          const fileSize = accessHandle.getSize()
          const buffer = new ArrayBuffer(fileSize)
          accessHandle.read(new DataView(buffer), { at: 0 })
          accessHandle.close()
          respond(
            'storage:read-bytes',
            requestId,
            true,
            { filename, bytes: buffer },
            undefined,
            // Transfer ownership of the buffer to avoid a copy.
            [buffer],
          )
        } catch (error) {
          console.error('error reading bytes:', error)
          respond('storage:read-bytes', requestId, false, undefined, error)
        }
        break
      }
      case 'storage:get-file': {
        // Hands back the OPFS `File` itself rather than its bytes. `fetch` can
        // stream a File off disk, so uploading a long recording never has to
        // materialize it in memory. That matters on a phone.
        const { filename, requestId } = payload
        try {
          const root = await navigator.storage.getDirectory()
          const handle = await root.getFileHandle(filename)
          const file = await handle.getFile()
          respond('storage:get-file', requestId, true, { file })
        } catch (error) {
          respond('storage:get-file', requestId, false, undefined, error)
        }
        break
      }
      case 'blob:put': {
        const { hash, bytes, requestId } = payload
        try {
          const directory = await blobCacheDirectory()
          const handle = await directory.getFileHandle(hash, { create: true })
          const accessHandle = await handle.createSyncAccessHandle()
          accessHandle.truncate(0)
          accessHandle.write(new DataView(bytes), { at: 0 })
          accessHandle.flush()
          accessHandle.close()
          respond('blob:put', requestId, true, { hash })
        } catch (error) {
          respond('blob:put', requestId, false, undefined, error)
        }
        break
      }
      case 'blob:get': {
        const { hash, mimeType, requestId } = payload
        try {
          const directory = await blobCacheDirectory()
          const handle = await directory.getFileHandle(hash)
          const file = await handle.getFile()
          respond('blob:get', requestId, true, {
            blob: new Blob([file], { type: mimeType }),
          })
        } catch (error) {
          respond('blob:get', requestId, false, undefined, error)
        }
        break
      }
      case 'blob:has': {
        const { hash, requestId } = payload
        try {
          const directory = await blobCacheDirectory()
          await directory.getFileHandle(hash)
          respond('blob:has', requestId, true, { present: true })
        } catch {
          respond('blob:has', requestId, true, { present: false })
        }
        break
      }
      case 'blob:delete': {
        const { hash, requestId } = payload
        try {
          const directory = await blobCacheDirectory()
          await directory.removeEntry(hash)
        } catch {
          // Already gone; the caller only cares that it is not there now.
        }
        respond('blob:delete', requestId, true, { hash })
        break
      }
      default:
        console.error('unknown message', event.data)
        // A caller waiting on this id has nothing else to go on. Answering
        // turns a typo in a message type into a rejected promise rather than
        // one that never settles.
        if (requestId) {
          respond(
            String(type),
            requestId,
            false,
            undefined,
            new Error(`unknown message type: ${String(type)}`),
          )
        }
        break
    }
  } catch (error) {
    // The contract this module keeps is that every request gets a reply. A
    // handler that throws on its way to `respond` would otherwise strand the
    // caller: `callWorker` settles on the reply and on nothing else. A handler
    // that already answered and then threw sends a second reply, which the
    // caller has stopped listening for.
    console.error('unhandled worker error:', error)
    if (requestId) {
      respond(String(type), requestId, false, undefined, error)
    }
  }
}

/**
 * Replies in the shape core's `callWorker` expects: the request id is echoed
 * so overlapping requests can be told apart. Errors are stringified because a
 * DOMException does not survive structured cloning intact.
 */
function respond(
  type: string,
  requestId: string,
  success: boolean,
  payload?: Record<string, unknown>,
  error?: unknown,
  transfer: Transferable[] = [],
) {
  ctx.postMessage(
    {
      type: `${type}:response`,
      requestId,
      success,
      payload,
      error:
        error instanceof Error
          ? error.message
          : error
            ? String(error)
            : undefined,
    },
    transfer,
  )
}
