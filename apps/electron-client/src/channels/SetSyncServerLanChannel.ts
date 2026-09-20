import { IpcChannel } from '@/types'
import { readSyncServerConfig, writeSyncServerConfig } from '@/syncServerConfig'
import { restartSyncServerFromConfig } from '@/syncServerRuntime'
import { IpcRequest, ValidIpcChanel } from '@tapes-monorepo/core'

export class SetSyncServerLanChannel implements IpcChannel {
  name: ValidIpcChanel = 'sync:set-lan-enabled'
  async handle(request: IpcRequest) {
    try {
      const { enabled } = request.data as { enabled: boolean }
      writeSyncServerConfig({ ...readSyncServerConfig(), lanEnabled: enabled })

      return await restartSyncServerFromConfig()
    } catch (error) {
      console.error('Failed to switch sync server binding:', error)
      return undefined
    }
  }
}
