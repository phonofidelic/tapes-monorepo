import {
  getLocalNetworkIp,
  startSyncServer,
  stopSyncServer,
  type SyncServerInfo,
} from './syncServer'
import {
  readSyncServerConfig,
  syncStoragePath,
  webClientDevUrl,
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

  // In the HMR dev flow, guests don't hit the sync socket directly: they load
  // the web-client's Vite dev server and reach the socket through its `/sync`
  // proxy over loopback. Both the loopback hop and the dev server (basic-ssl)
  // are already secure contexts, so the embedded server needs no TLS of its own
  // — and running it plain keeps that proxy's `ws://` target valid. TLS is only
  // for the production flow, where guests connect to this origin directly.
  const devWebAppUrl = webClientDevUrl()
  const tls =
    config.httpsEnabled && !devWebAppUrl ? ensureSyncServerCert(lanIp) : undefined

  return startSyncServer({
    storagePath: syncStoragePath(),
    host,
    peerId: config.peerId,
    webClientPath: webClientPath(),
    webAppDevUrl: devWebAppUrl,
    tls,
  })
}

export async function restartSyncServerFromConfig(): Promise<SyncServerInfo> {
  await stopSyncServer()
  return startSyncServerFromConfig()
}
