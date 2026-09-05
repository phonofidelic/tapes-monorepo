import {
  getLocalNetworkIp,
  startSyncServer,
  stopSyncServer,
  type SyncServerInfo,
} from './syncServer'
import {
  blobStoragePath,
  eventStoragePath,
  readSyncServerConfig,
  syncServerPort,
  syncStoragePath,
  webClientDevUrl,
  webClientPath,
} from './syncServerConfig'
import { ensureSyncServerCert } from './certManager'

/**
 * Turns the persisted sync-server config into runtime options and starts the
 * server. Binds LAN-wide when sharing is on. Mints or loads a self-signed cert
 * with the current LAN IP in its SAN when HTTPS is on. Shared by the app
 * bootstrap and the IPC toggles so the option-building lives in one place.
 */
export async function startSyncServerFromConfig(): Promise<SyncServerInfo> {
  const config = readSyncServerConfig()
  const host = config.lanEnabled ? '0.0.0.0' : '127.0.0.1'
  const lanIp = config.lanEnabled ? getLocalNetworkIp() : undefined

  // In the HMR dev flow guests do not reach the sync socket directly. They load
  // the Vite dev server and go through its `/sync` proxy over loopback. The dev
  // server runs basic-ssl and loopback is trusted, so both hops are already
  // secure contexts. The embedded server needs no TLS, and running it plain
  // keeps the proxy's `ws://` target valid. TLS is for the production flow,
  // where guests connect to this origin directly.
  const devWebAppUrl = webClientDevUrl()
  const tls =
    config.httpsEnabled && !devWebAppUrl
      ? ensureSyncServerCert(lanIp)
      : undefined

  return startSyncServer({
    storagePath: syncStoragePath(),
    host,
    // Undefined unless something pinned one, which leaves `startSyncServer` on
    // its own default.
    port: syncServerPort(),
    peerId: config.peerId,
    webClientPath: webClientPath(),
    webAppDevUrl: devWebAppUrl,
    tls,
    blobStorePath: blobStoragePath(),
    eventStorePath: eventStoragePath(),
    pairingToken: config.pairingToken,
  })
}

export async function restartSyncServerFromConfig(): Promise<SyncServerInfo> {
  await stopSyncServer()
  return startSyncServerFromConfig()
}
