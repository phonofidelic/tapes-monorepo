import path from 'path'
import { rename } from 'fs/promises'
import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

export class EditRecordingChannel implements IpcChannel {
  name = 'storage:edit-recording'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel, data } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for recorder:start request`)
    }

    if (!isValidEditRecordingRequestData(data)) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    const { filename, filepath } = data

    try {
      const newPath = path.join(
        path.dirname(filepath),
        filename + path.extname(filepath),
      )
      await rename(filepath, newPath)
      event.sender.send(responseChannel, {
        success: true,
        data: { filepath: newPath },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(responseChannel, {
        success: false,
        error: new Error('Could not rename file'),
      })
    }
  }
}

const isValidEditRecordingRequestData = (
  data: unknown,
): data is {
  filename: string
  filepath: string
} => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'filename' in data &&
    'filepath' in data &&
    typeof data.filename === 'string' &&
    typeof data.filepath === 'string'
  )
}
