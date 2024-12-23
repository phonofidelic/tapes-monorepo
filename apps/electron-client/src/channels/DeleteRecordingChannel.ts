import { rm } from 'fs/promises'
import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

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

    const { filepath } = data

    try {
      console.log('Deleting recording', filepath)
      await rm(filepath)
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
): data is { filepath: string } => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'filepath' in data &&
    typeof data.filepath === 'string' &&
    data.filepath.length > 0
  )
}
