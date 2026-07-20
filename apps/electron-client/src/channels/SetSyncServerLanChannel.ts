import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { startSyncServer, stopSyncServer } from '@/syncServer'
import {
  readSyncServerConfig,
  syncStoragePath,
  writeSyncServerConfig,
} from '@/syncServerConfig'

export class SetSyncServerLanChannel implements IpcChannel {
  name = 'sync:set-lan-enabled'
  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      return
    }

    try {
      const { enabled } = request.data as { enabled: boolean }
      const config = { ...readSyncServerConfig(), lanEnabled: enabled }
      writeSyncServerConfig(config)

      await stopSyncServer()
      const info = await startSyncServer({
        storagePath: syncStoragePath(),
        host: enabled ? '0.0.0.0' : '127.0.0.1',
        peerId: config.peerId,
      })

      event.sender.send(responseChannel, info)
    } catch (error) {
      console.error('Failed to switch sync server binding:', error)
      event.sender.send(responseChannel, undefined)
    }
  }
}
