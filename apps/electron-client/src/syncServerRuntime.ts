import {
  getLocalNetworkIp,
  startSyncServer,
  stopSyncServer,
  type SyncServerInfo,
} from './syncServer'
import {
  readSyncServerConfig,
  syncStoragePath,
  webClientPath,
} from './syncServerConfig'
import { ensureSyncServerCert } from './certManager'

/**
 * Composes the persisted sync-server config into runtime options and starts
 * the server: binds LAN-wide when sharing is on, and mints/loads a self-signed
 * cert (with the current LAN IP in its SAN) when HTTPS is on. Shared by the app
 * bootstrap and the IPC toggles so the option-building logic lives in one place.
 */
export async function startSyncServerFromConfig(): Promise<SyncServerInfo> {
  const config = readSyncServerConfig()
  const host = config.lanEnabled ? '0.0.0.0' : '127.0.0.1'
  const lanIp = config.lanEnabled ? getLocalNetworkIp() : undefined
  const tls = config.httpsEnabled
    ? await ensureSyncServerCert(lanIp)
    : undefined

  return startSyncServer({
    storagePath: syncStoragePath(),
    host,
    peerId: config.peerId,
    webClientPath: webClientPath(),
    tls,
  })
}

export async function restartSyncServerFromConfig(): Promise<SyncServerInfo> {
  await stopSyncServer()
  return startSyncServerFromConfig()
}
