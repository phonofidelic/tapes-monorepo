import { rm } from 'fs/promises'
import { asError } from '@/asError'
import { getBlobStore } from '@/syncServer'
import {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

export class DeleteRecordingChannel implements IpcChannel {
  name: ValidIpcChanel = 'storage:delete-recording'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const { data } = request
    if (!isValidDeleteRecordingRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const { filepath, hash, docUrl } = data

    try {
      // Two links can hold the audio: the user's own file, and the blob store
      // object hardlinked to it. Both have to go before the disk space comes
      // back.
      if (hash && docUrl) {
        await getBlobStore()?.releaseRef(hash, docUrl)
      }
      if (filepath) {
        console.log('Deleting recording', filepath)
        await rm(filepath)
      }
      return { success: true }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}

const isValidDeleteRecordingRequestData = (
  data: unknown,
): data is { filepath?: string; hash?: string; docUrl?: string } => {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const hasFilepath =
    'filepath' in data &&
    typeof data.filepath === 'string' &&
    data.filepath.length > 0
  const hasBlob =
    'hash' in data && typeof data.hash === 'string' && data.hash.length > 0
  // A recording synced from another device has no local filepath, and a doc
  // predating the blob store has no hash. One of the two must identify
  // something to delete.
  return hasFilepath || hasBlob
}
