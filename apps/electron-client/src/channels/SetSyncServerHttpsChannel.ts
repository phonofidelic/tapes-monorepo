import { IpcChannel } from '@/types'
import { readSyncServerConfig, writeSyncServerConfig } from '@/syncServerConfig'
import { restartSyncServerFromConfig } from '@/syncServerRuntime'
import { IpcRequest, ValidIpcChanel } from '@tapes-monorepo/core'

export class SetSyncServerHttpsChannel implements IpcChannel {
  name: ValidIpcChanel = 'sync:set-https-enabled'
  async handle(request: IpcRequest) {
    try {
      const { enabled } = request.data as { enabled: boolean }
      writeSyncServerConfig({
        ...readSyncServerConfig(),
        httpsEnabled: enabled,
      })

      return await restartSyncServerFromConfig()
    } catch (error) {
      console.error('Failed to switch sync server TLS:', error)
      return undefined
    }
  }
}
