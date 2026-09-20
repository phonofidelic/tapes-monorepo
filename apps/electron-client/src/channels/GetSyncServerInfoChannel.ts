import { IpcMainEvent } from 'electron'
import { IpcChannel } from '@/types'
import { getSyncServerInfo } from '@/syncServer'
import { IpcRequest } from '@tapes-monorepo/core'

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
