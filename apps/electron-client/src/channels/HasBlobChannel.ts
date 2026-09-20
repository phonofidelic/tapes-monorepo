import { asError } from '@/asError'
import { getBlobStore } from '@/syncServer'
import {
  HasBlobResponse,
  IpcChannel,
  IpcRequest,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * Whether this device already holds a blob's bytes, so playback can skip the
 * network. On a host the blob store *is* the local cache.
 */
export class HasBlobChannel implements IpcChannel {
  name: ValidIpcChanel = 'blob:has'

  async handle(request: IpcRequest): Promise<HasBlobResponse> {
    const { data } = request
    if (!isValidHasBlobRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const store = getBlobStore()
    if (!store) {
      return { success: true, data: { present: false } }
    }

    try {
      const meta = await store.stat(data.hash)
      return {
        success: true,
        data: meta
          ? { present: true, size: meta.size, mimeType: meta.mimeType }
          : { present: false },
      }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}

const isValidHasBlobRequestData = (data: unknown): data is { hash: string } =>
  typeof data === 'object' &&
  data !== null &&
  'hash' in data &&
  typeof data.hash === 'string' &&
  data.hash.length > 0
