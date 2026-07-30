import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getBlobStore } from '../syncServer'

/**
 * Whether this device already holds a blob's bytes, so playback can skip the
 * network. On a host the blob store *is* the local cache.
 */
export class HasBlobChannel implements IpcChannel {
  name: string = 'blob:has'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { data } = request
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    if (!isValidHasBlobRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const store = getBlobStore()
    if (!store) {
      event.sender.send(request.responseChannel, {
        success: true,
        data: { present: false },
      })
      return
    }

    try {
      const meta = await store.stat(data.hash)
      event.sender.send(request.responseChannel, {
        success: true,
        data: meta
          ? { present: true, size: meta.size, mimeType: meta.mimeType }
          : { present: false },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, { success: false, error })
    }
  }
}

const isValidHasBlobRequestData = (data: unknown): data is { hash: string } =>
  typeof data === 'object' &&
  data !== null &&
  'hash' in data &&
  typeof data.hash === 'string' &&
  data.hash.length > 0
