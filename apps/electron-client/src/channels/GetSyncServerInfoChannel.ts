import { getSyncServerInfo } from '@/syncServer'
import {
  IpcChannel,
  SyncServerInfo,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

export class GetSyncServerInfoChannel implements IpcChannel {
  name: ValidIpcChanel = 'sync:get-server-info'
  handle(): SyncServerInfo {
    return getSyncServerInfo()
  }
}
