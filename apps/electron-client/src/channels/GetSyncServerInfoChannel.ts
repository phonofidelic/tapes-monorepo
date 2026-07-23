import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getSyncServerInfo } from '@/syncServer'

export class GetSyncServerInfoChannel implements IpcChannel {
  name = 'sync:get-server-info'
  handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      return
    }
    event.sender.send(responseChannel, getSyncServerInfo())
  }
}
