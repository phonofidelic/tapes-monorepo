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

    const filepath = path.resolve(request.data.storageLocation, 'test.txt')

    const centiseconds = (
      '0' +
      (Math.floor(request.data.duration / 10) % 100)
    ).slice(-2)
    const seconds = (
      '0' +
      (Math.floor(request.data.duration / 1000) % 60)
    ).slice(-2)
    const minutes = (
      '0' +
      (Math.floor(request.data.duration / 60000) % 60)
    ).slice(-2)
    const hours = ('0' + Math.floor(request.data.duration / 3600000)).slice(-2)

    try {
      await writeFile(
        filepath,
        `Test-file content, duration: ${hours}:${minutes}:${seconds}:${centiseconds}`,
        { encoding: 'utf-8' },
      )
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
  duration: number
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string' ||
    !('duration' in data) ||
    typeof data.duration !== 'number'
  ) {
    return false
  }
  return true
}
