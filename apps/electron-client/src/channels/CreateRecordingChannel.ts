import { IpcChannel, IpcRequest } from '@/types'
import { ipcMain, IpcMainEvent } from 'electron'
import { writeFile } from 'fs/promises'
import path from 'path'

export class CreateRecordingChannel implements IpcChannel {
  name = 'recorder:start'
  private responseChannel: string | null = null
  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel, data } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for recorder:start request`)
    }

    if (!isValidCreateRecordingRequestData(data)) {
      throw new Error(`Invalid data provided for recorder:start request`)
    }

    if (!this.responseChannel) {
      this.responseChannel = responseChannel
      this.registerResponse(event, request)
    }
    event.sender.send(responseChannel, {
      success: true,
    })
  }

  private async registerResponse(event: IpcMainEvent, request: IpcRequest) {
    ipcMain.on('recorder:stop', async () => {
      if (!this.responseChannel) {
        throw new Error(
          `No response channel provided for recorder:stop request`,
        )
      }

      if (!isValidCreateRecordingRequestData(request.data)) {
        throw new Error(`Invalid data provided for recorder:stop request`)
      }

      try {
        console.log(
          '* request.data.storageLocation:',
          request.data.storageLocation,
        )
        await writeFile(
          path.resolve(request.data.storageLocation, 'test.txt'),
          'Test-file content',
          { encoding: 'utf-8' },
        )
      } catch (error) {
        console.error('Could not write file:', error)
        event.sender.send(this.responseChannel, {
          success: false,
        })
        this.responseChannel = null
        return
      }

      event.sender.send(this.responseChannel, {
        success: true,
      })

      this.responseChannel = null
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
