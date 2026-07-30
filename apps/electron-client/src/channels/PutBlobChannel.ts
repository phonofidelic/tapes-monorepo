import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getBlobStore } from '../syncServer'

/**
 * Ingests a just-recorded file into the host's blob store, hardlinking it so
 * the bytes are not duplicated. The renderer writes the returned descriptor
 * into the recording doc; guests then fetch by hash over `/blobs`.
 */
export class PutBlobChannel implements IpcChannel {
  name: string = 'blob:put-file'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { data } = request
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    if (!isValidPutBlobRequestData(data)) {
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
      const { meta } = await store.ingestFile(data.filepath, {
        docUrl: data.docUrl,
      })
      event.sender.send(request.responseChannel, {
        success: true,
        data: {
          hash: meta.hash,
          size: meta.size,
          mimeType: meta.mimeType,
          ext: meta.ext,
        },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, { success: false, error })
    }
  }
}

const isValidPutBlobRequestData = (
  data: unknown,
): data is { filepath: string; docUrl: string } =>
  typeof data === 'object' &&
  data !== null &&
  'filepath' in data &&
  typeof data.filepath === 'string' &&
  data.filepath.length > 0 &&
  'docUrl' in data &&
  typeof data.docUrl === 'string' &&
  data.docUrl.length > 0
