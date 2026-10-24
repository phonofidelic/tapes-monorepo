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
 *
 * The worker also signs each finished recording, because it holds the files
 * and can read the device key from IndexedDB. It owns the person key for the
 * same reason, and runs the backup's Argon2id off the page.
 */
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import {
  createRecordingClaim,
  encodeSignedStatement,
  exportPublicKey,
} from '@tapes-monorepo/provenance'
import { loadDeviceSigningKey } from './deviceSigningKey'
import { generatePassphrase } from './passphrase'
import {
  backUpPersonKey,
  checkPersonKeyBackup,
  acceptVouch,
  createPersonKey,
  deviceLinkAddress,
  markJoined,
  personKeyStatus,
  signJoinRequest,
  signVouchRequest,
} from './personKeyRequests'

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
      type: 'recorder:claim'
      payload: {
        filename: string
        /** Used when the OPFS file has no type, as the upload does. */
        mimeType: string
        startedAt: string
        endedAt: string
        /** The session open when the take started. Absent outside one. */
        sessionId?: string
        requestId: string
      }
    }
  | {
      type: 'provenance:device-key'
      payload: {
        requestId: string
      }
    }
  | {
      type: 'person:status' | 'person:passphrase'
      payload: {
        requestId: string
      }
    }
  | {
      type: 'person:create'
      payload: {
        deviceLabel: string
        requestId: string
      }
    }
  | {
      type: 'person:backup'
      payload: {
        passphrase: string
        requestId: string
      }
    }
  | {
      type: 'person:sign-join'
      payload: {
        challenge: string
        personName: string
        requestId: string
      }
    }
  | {
      type: 'person:request-vouch'
      payload: {
        personKey: string
        deviceLabel: string
        requestId: string
      }
    }
  | {
      type: 'person:accept-vouch'
      payload: {
        vouch: string
        pinnedHostKey?: string
        requestId: string
      }
    }
  | {
      type: 'person:mark-joined'
      payload: {
        requestId: string
      }
    }
  | {
      type: 'person:check-backup'
      payload: {
        text: string
        passphrase: string
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

// The chunk write in progress. Handlers run concurrently across their awaits,
// so a claim requested right after the last chunk waits on this.
let pendingWrite: Promise<void> = Promise.resolve()

/**
 * Hashes in chunks off a stream, so a long recording is never held in memory
 * whole. WebCrypto can only digest a complete buffer.
 */
async function sha256Hex(file: Blob): Promise<string> {
  const hasher = sha256.create()
  const reader = file.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      return bytesToHex(hasher.digest())
    }
    hasher.update(value)
  }
}

async function writeChunk(chunk: Blob) {
  if (!ctx.accessHandle) {
    return
  }
  try {
    const bytes = await chunk.arrayBuffer()
    ctx.accessHandle.write(bytes)
    ctx.accessHandle.flush()
    ctx.accessHandle.close()
    ctx.accessHandle = null
  } catch (error) {
    console.error('error writing to file:', error)
  }
}

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
        pendingWrite = writeChunk(chunk)
        await pendingWrite
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
      case 'recorder:claim': {
        // Hashes the bytes this device captured and signs a claim over them,
        // before anything is uploaded. Fails without a device key, and the
        // caller then uploads unsigned. Names the device certificate when
        // this guest has a person key, or the host's vouch when it re-joined
        // without one.
        const { filename, mimeType, startedAt, endedAt, sessionId, requestId } =
          payload
        try {
          await pendingWrite
          const keyPair = await loadDeviceSigningKey()
          const deviceCert = await deviceLinkAddress().catch(
            (error: unknown) => {
              console.warn('Signing without a device certificate:', error)
              return undefined
            },
          )
          const root = await navigator.storage.getDirectory()
          const file = await (await root.getFileHandle(filename)).getFile()
          const signed = await createRecordingClaim(
            {
              blob: {
                hash: await sha256Hex(file),
                size: file.size,
                mimeType: file.type || mimeType,
              },
              startedAt,
              endedAt,
              sessionId,
              deviceCert,
            },
            keyPair,
          )
          respond('recorder:claim', requestId, true, {
            claim: encodeSignedStatement(signed),
          })
        } catch (error) {
          respond('recorder:claim', requestId, false, undefined, error)
        }
        break
      }
      case 'provenance:device-key': {
        // The key this device signs its claims with, so the Library can say
        // "this device" for them. Creates the key if there is none yet.
        const { requestId } = payload
        try {
          const keyPair = await loadDeviceSigningKey()
          respond('provenance:device-key', requestId, true, {
            publicKey: await exportPublicKey(keyPair.publicKey),
          })
        } catch (error) {
          respond('provenance:device-key', requestId, false, undefined, error)
        }
        break
      }
      case 'person:status': {
        // The person key on this guest, without making one.
        const { requestId } = payload
        try {
          respond(type, requestId, true, await personKeyStatus())
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:create': {
        // On first join. Makes the person key and certifies this device.
        const { deviceLabel, requestId } = payload
        try {
          respond(type, requestId, true, await createPersonKey(deviceLabel))
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:passphrase': {
        const { requestId } = payload
        respond(type, requestId, true, { passphrase: generatePassphrase() })
        break
      }
      case 'person:backup': {
        // Runs Argon2id here, which blocks this worker for about a second.
        const { passphrase, requestId } = payload
        try {
          respond(type, requestId, true, await backUpPersonKey(passphrase))
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:sign-join': {
        const { challenge, personName, requestId } = payload
        try {
          respond(
            type,
            requestId,
            true,
            await signJoinRequest(challenge, personName),
          )
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:request-vouch': {
        const { personKey, deviceLabel, requestId } = payload
        try {
          respond(
            type,
            requestId,
            true,
            await signVouchRequest(personKey, deviceLabel),
          )
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:accept-vouch': {
        const { vouch, pinnedHostKey, requestId } = payload
        try {
          respond(
            type,
            requestId,
            true,
            await acceptVouch(vouch, pinnedHostKey),
          )
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:mark-joined': {
        const { requestId } = payload
        try {
          respond(type, requestId, true, await markJoined())
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
        break
      }
      case 'person:check-backup': {
        const { text, passphrase, requestId } = payload
        try {
          respond(
            type,
            requestId,
            true,
            await checkPersonKeyBackup(text, passphrase),
          )
        } catch (error) {
          respond(type, requestId, false, undefined, error)
        }
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
