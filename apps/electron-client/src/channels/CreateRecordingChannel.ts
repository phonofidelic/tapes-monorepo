import path from 'path'
import { writeFile } from 'fs/promises'
import { ipcMain, IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

export class CreateRecordingChannel implements IpcChannel {
  name = 'recorder:start'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for recorder:start request`)
    }

    ipcMain.once('recorder:stop', this.onRecorderStop.bind(this))

    event.sender.send(responseChannel, {
      data: {},
      success: true,
    })
  }

  private async onRecorderStop(event: IpcMainEvent, request: IpcRequest) {
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for recorder:stop request`)
    }

    if (!isValidCreateRecordingRequestData(request.data)) {
      throw new Error(`Invalid data provided for recorder:stop request`)
    }

    const filepath = path.resolve(
      request.data.storageLocation,
      'nope',
      'test.txt',
    )

    try {
      await writeFile(filepath, 'Test-file content', { encoding: 'utf-8' })
    } catch (error) {
      event.sender.send(request.responseChannel, {
        error: new Error('Could not write file'),
        success: false,
      })
      return
    }

    event.sender.send(request.responseChannel, {
      data: { filepath },
      success: true,
    })
  }
}

const isValidCreateRecordingRequestData = (
  data: unknown,
): data is {
  storageLocation: string
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string'
  ) {
    return false
  }
  return true
}
