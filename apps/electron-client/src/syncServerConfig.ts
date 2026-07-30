import crypto from 'crypto'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

export type SyncServerConfig = {
  peerId: string
  lanEnabled: boolean
  // Serve the LAN over self-signed HTTPS so guests get a secure context
  // (required for playback and recording, not just plain browsing).
  httpsEnabled: boolean
  // Bearer token guarding the `/blobs` HTTP surface. The sync socket itself is
  // still unauthenticated on the LAN, but blobs add a *write* endpoint that
  // consumes the host's disk, so leaving those open would be strictly worse
  // than the status quo. Distributed to guests via the QR pairing URL.
  blobToken: string
}

const configFilePath = () =>
  path.join(app.getPath('userData'), 'sync-server.json')

export const syncStoragePath = () =>
  path.join(app.getPath('userData'), 'sync-storage')

/** Root of the content-addressed audio store served over `/blobs`. */
export const blobStoragePath = () => path.join(app.getPath('userData'), 'blobs')

const createBlobToken = () => crypto.randomBytes(32).toString('base64url')

/**
 * Resolves the directory of the bundled web-client, staged as an
 * `extraResource` in production (see forge.config.ts) and read from the
 * sibling package's `dist` in development. Returns `undefined` when no built
 * bundle is present, so hosting is only advertised when it can actually work.
 */
export const webClientPath = (): string | undefined => {
  const candidate =
    process.env.NODE_ENV !== 'development'
      ? path.resolve(process.resourcesPath, 'web-client')
      : path.resolve(app.getAppPath(), '..', 'web-client', 'dist')

  return existsSync(path.join(candidate, 'index.html')) ? candidate : undefined
}

/**
 * In development the web-client is served by its own Vite dev server (for HMR),
 * not the statically staged bundle. The dev scripts pass its LAN URL via
 * `WEB_CLIENT_DEV_URL`; when present we advertise it to guests (see the QR/copy
 * flow in core's Settings) so they load the HMR-enabled app instead of a stale
 * static build. Returns `undefined` outside development.
 */
export const webClientDevUrl = (): string | undefined =>
  process.env.NODE_ENV === 'development'
    ? process.env.WEB_CLIENT_DEV_URL
    : undefined

export function readSyncServerConfig(): SyncServerConfig {
  try {
    const stored = JSON.parse(
      readFileSync(configFilePath(), 'utf-8'),
    ) as Partial<SyncServerConfig>
    if (typeof stored.peerId === 'string') {
      const config: SyncServerConfig = {
        peerId: stored.peerId,
        lanEnabled: stored.lanEnabled === true,
        httpsEnabled: stored.httpsEnabled === true,
        // Configs written before blobs existed have no token; mint one and
        // persist it so it stays stable across restarts (a token that changed
        // every launch would unpair every guest).
        blobToken:
          typeof stored.blobToken === 'string' && stored.blobToken.length > 0
            ? stored.blobToken
            : createBlobToken(),
      }
      if (config.blobToken !== stored.blobToken) {
        writeSyncServerConfig(config)
      }
      return config
    }
  } catch {
    // Missing or corrupt config falls through to defaults.
  }

  const config: SyncServerConfig = {
    peerId: `tapes-embedded-${crypto.randomUUID()}`,
    lanEnabled: false,
    httpsEnabled: false,
    blobToken: createBlobToken(),
  }
  writeSyncServerConfig(config)
  return config
}

export function writeSyncServerConfig(config: SyncServerConfig) {
  writeFileSync(configFilePath(), JSON.stringify(config, null, 2))
}
