import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { readSyncServerConfig, writeSyncServerConfig } from '@/syncServerConfig'
import { restartSyncServerFromConfig } from '@/syncServerRuntime'

export class SetSyncServerHttpsChannel implements IpcChannel {
  name = 'sync:set-https-enabled'
  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      return
    }

    try {
      const { enabled } = request.data as { enabled: boolean }
      writeSyncServerConfig({
        ...readSyncServerConfig(),
        httpsEnabled: enabled,
      })

      const info = await restartSyncServerFromConfig()

      event.sender.send(responseChannel, info)
    } catch (error) {
      console.error('Failed to switch sync server TLS:', error)
      event.sender.send(responseChannel, undefined)
    }
  }
}
