import path from 'path'
import { rename } from 'fs/promises'
import {
  EditRecordingResponse,
  IpcChannel,
  IpcRequest,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

export class EditRecordingChannel implements IpcChannel {
  name: ValidIpcChanel = 'storage:edit-recording'

  async handle(request: IpcRequest): Promise<EditRecordingResponse> {
    const { data } = request
    if (!isValidEditRecordingRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const { filename, filepath } = data

    try {
      const newPath = path.join(
        path.dirname(filepath),
        filename + path.extname(filepath),
      )
      await rename(filepath, newPath)
      return { success: true, data: { filepath: newPath } }
    } catch (error) {
      console.error(error)
      return { success: false, error: new Error('Could not rename file') }
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
