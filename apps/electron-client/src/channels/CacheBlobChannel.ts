import { Readable } from 'stream'
import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getBlobStore } from '../syncServer'

/**
 * Stores bytes this device fetched from elsewhere. An electron client is
 * normally the host, so its blob store doubles as the local cache: ingesting
 * here is what makes a fetched recording playable offline, and adds the
 * document to the refcount so the bytes are not dropped from under it.
 */
export class CacheBlobChannel implements IpcChannel {
  name: string = 'blob:cache-put'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { data } = request
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    if (!isValidCacheBlobRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const store = getBlobStore()
    if (!store) {
      event.sender.send(request.responseChannel, {
        success: false,
        error: new Error('Blob store is not available'),
      })
      return
    }

    try {
      const { meta } = await store.ingestStream(
        Readable.from(Buffer.from(data.bytes)),
        { mimeType: data.mimeType, docUrl: data.docUrl },
      )
      if (meta.hash !== data.hash) {
        // The bytes are not what was asked for. Refuse rather than cache them
        // under a hash that would then serve the wrong audio.
        await store.releaseRef(meta.hash, data.docUrl)
        throw new Error(
          `Blob hash mismatch: expected ${data.hash}, got ${meta.hash}`,
        )
      }
      event.sender.send(request.responseChannel, {
        success: true,
        data: { hash: meta.hash },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, { success: false, error })
    }
  }
}

const isValidCacheBlobRequestData = (
  data: unknown,
): data is {
  hash: string
  mimeType: string
  docUrl: string
  bytes: Uint8Array
} =>
  typeof data === 'object' &&
  data !== null &&
  'hash' in data &&
  typeof data.hash === 'string' &&
  'mimeType' in data &&
  typeof data.mimeType === 'string' &&
  'docUrl' in data &&
  typeof data.docUrl === 'string' &&
  'bytes' in data &&
  data.bytes instanceof Uint8Array
