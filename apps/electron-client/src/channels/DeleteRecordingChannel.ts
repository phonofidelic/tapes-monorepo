import { rm } from 'fs/promises'
import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getBlobStore } from '../syncServer'

export class DeleteRecordingChannel implements IpcChannel {
  name: string = 'storage:delete-recording'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { data } = request
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

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
      event.sender.send(request.responseChannel, { success: true })
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, {
        success: false,
        error,
      })
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
