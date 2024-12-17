import { dialog, IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

export class OpenDirectoryDialogChannel implements IpcChannel {
  name = 'storage:open-directory-dialog'
  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      return
    }

    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      })
      if (result.canceled) {
        event.sender.send(responseChannel, '__unset__')
        return
      }
      event.sender.send(responseChannel, result.filePaths[0])
    } catch (error) {
      event.sender.send(responseChannel, undefined)
    }
  }
}
