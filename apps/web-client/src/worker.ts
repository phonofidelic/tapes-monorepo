/**
 * The recording worker. Owns the OPFS files behind the web client: recordings
 * this device made live flat in the OPFS root under uuid names, and blobs
 * fetched from the sync host live in `blobs/` under their content hash.
 *
 * Messages arrive from core as `{ type, payload }`. The blob and get-file
 * handlers echo a `requestId` through `respond` so overlapping requests can be
 * told apart. The older recorder and storage handlers reply without one.
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
      payload: never
    }
  | {
      type: 'storage:get'
      payload: {
        filename: string
      }
    }
  | {
      type: 'storage:read-bytes'
      payload: {
        filename: string
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

  switch (type) {
    case 'recorder:start': {
      const { audioFormat, audioInputDeviceId } = payload
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

        ctx.postMessage({
          type: 'recorder:start:response',
          payload: {
            message: 'recording started',
            filename: fileHandle.name,
          },
        })
      } catch (error) {
        console.error('error:', error)
        ctx.postMessage({
          type: 'recorder:start:error',
          payload: {
            message: 'error creating file',
            error,
          },
        })
      }

      break
    }
    case 'recorder:write': {
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
      if (ctx.accessHandle) {
        ctx.accessHandle.flush()
      }

      ctx.postMessage({
        type: 'recorder:stop:response',
        payload: { message: 'recording stopped' },
      })
      break
    }
    case 'storage:get': {
      const { filename } = payload
      const root = await navigator.storage.getDirectory()
      try {
        const handle = await root.getFileHandle(filename)
        const accessHandle = await handle.createSyncAccessHandle()
        const fileSize = accessHandle.getSize()
        const buffer = new DataView(new ArrayBuffer(fileSize))
        accessHandle.read(buffer, { at: 0 })

        const blob = new Blob([buffer], { type: 'audio/mp4' })
        const url = URL.createObjectURL(blob)
        ctx.postMessage({
          type: 'storage:get:response',
          success: true,
          payload: {
            message: 'file retrieved',
            url,
            blob,
          },
        })
        accessHandle.close()
      } catch (error) {
        console.error('error, event:', error)
        ctx.postMessage({
          type: 'storage:get:response',
          success: false,
          error,
          payload: {
            message: 'error retrieving file',
          },
        })
      }
      break
    }
    case 'storage:read-bytes': {
      // Was how the recorder got bytes to embed in the Automerge doc. Nothing
      // in core calls it now that audio is uploaded out of band via
      // `storage:get-file`; kept until the legacy read path is retired.
      const { filename } = payload
      const root = await navigator.storage.getDirectory()
      try {
        const handle = await root.getFileHandle(filename)
        const accessHandle = await handle.createSyncAccessHandle()
        const fileSize = accessHandle.getSize()
        const buffer = new ArrayBuffer(fileSize)
        accessHandle.read(new DataView(buffer), { at: 0 })
        accessHandle.close()
        ctx.postMessage(
          {
            type: 'storage:read-bytes:response',
            success: true,
            payload: {
              message: 'bytes retrieved',
              filename,
              bytes: buffer,
            },
          },
          // Transfer ownership of the buffer to avoid a copy.
          [buffer],
        )
      } catch (error) {
        console.error('error reading bytes:', error)
        ctx.postMessage({
          type: 'storage:read-bytes:response',
          success: false,
          error,
          payload: {
            message: 'error reading bytes',
            filename,
          },
        })
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
      break
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
) {
  ctx.postMessage({
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
  })
}
