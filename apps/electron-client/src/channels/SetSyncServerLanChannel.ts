import { IpcMainEvent } from 'electron'
import { IpcChannel } from '@/types'
import { readSyncServerConfig, writeSyncServerConfig } from '@/syncServerConfig'
import { restartSyncServerFromConfig } from '@/syncServerRuntime'
import { IpcRequest } from '@tapes-monorepo/core'

export class SetSyncServerLanChannel implements IpcChannel {
  name = 'sync:set-lan-enabled'
  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      return
    }

    try {
      const { enabled } = request.data as { enabled: boolean }
      writeSyncServerConfig({ ...readSyncServerConfig(), lanEnabled: enabled })

      const info = await restartSyncServerFromConfig()

      event.sender.send(responseChannel, info)
    } catch (error) {
      console.error('Failed to switch sync server binding:', error)
      event.sender.send(responseChannel, undefined)
    }
  }
}
