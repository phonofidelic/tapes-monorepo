import crypto from 'crypto'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

export type SyncServerConfig = {
  peerId: string
  lanEnabled: boolean
  // Serve the LAN over self-signed HTTPS so guests get a secure context, which
  // playback and recording both require.
  httpsEnabled: boolean
  // Shared secret guarding everything this host exposes on the LAN: the blob
  // routes and the sync socket's upgrade. Minted once and handed to guests in
  // the QR pairing url. Without it anyone who can route to the port could read
  // or rewrite the whole library. Rotating it unpairs every guest at once.
  // There is no per-device revocation.
  pairingToken: string
  /**
   * Library roots this host has been told about, so the blob GC can mark
   * against them. Persisted because the root url otherwise lives only in the
   * renderer's localStorage, and a sweep that forgot a library would treat all
   * of its audio as unreferenced.
   */
  knownRoots?: string[]
}

const configFilePath = () =>
  path.join(app.getPath('userData'), 'sync-server.json')

export const syncStoragePath = () =>
  path.join(app.getPath('userData'), 'sync-storage')

/** Root of the content-addressed audio store served over `/blobs`. */
export const blobStoragePath = () => path.join(app.getPath('userData'), 'blobs')

/**
 * Root of the append-only playback-event log. A sibling of the blob store, not
 * a directory inside it. Audio lives as long as its recording and events for
 * 90 days, and a retention sweep that could reach into `blobs/` could unlink
 * audio.
 */
export const eventStoragePath = () =>
  path.join(app.getPath('userData'), 'events')

/**
 * Port the embedded server binds, when something has pinned one.
 *
 * Normally the server takes the default port, or whatever the OS hands it when
 * that is taken. The e2e suite needs a fixed port. It starts a second copy of
 * this app beside the developer's own, and the guest's dev server proxies to a
 * port chosen before either process exists. The web-client's dev server reads
 * `TAPES_SYNC_SERVER_PORT` too, so the two agree by construction.
 */
export const syncServerPort = (): number | undefined => {
  const port = Number(process.env.TAPES_SYNC_SERVER_PORT)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined
}

const createPairingToken = () => crypto.randomBytes(32).toString('base64url')

/**
 * Directory of the bundled web-client. In production it is staged as an extra
 * resource by the forge config. In development it is the sibling package's
 * `dist`. Returns undefined when no built bundle is present, so hosting is
 * only advertised when it can work.
 */
export const webClientPath = (): string | undefined => {
  const candidate =
    process.env.NODE_ENV !== 'development'
      ? path.resolve(process.resourcesPath, 'web-client')
      : path.resolve(app.getAppPath(), '..', 'web-client', 'dist')

  return existsSync(path.join(candidate, 'index.html')) ? candidate : undefined
}

/**
 * In development the web-client is served by its own Vite dev server, for HMR,
 * not the staged bundle. The dev scripts pass its LAN url in an environment
 * variable, and core's Settings advertises it to guests through the QR and
 * copy flow so they load the live app. Returns undefined outside development.
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
        // Configs written before the token existed have none. Mint one and
        // persist it so it stays stable across restarts. A token that changed
        // every launch would unpair every guest.
        pairingToken:
          typeof stored.pairingToken === 'string' &&
          stored.pairingToken.length > 0
            ? stored.pairingToken
            : createPairingToken(),
        knownRoots: Array.isArray(stored.knownRoots)
          ? stored.knownRoots.filter(
              (root): root is string => typeof root === 'string',
            )
          : undefined,
      }
      if (config.pairingToken !== stored.pairingToken) {
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
    pairingToken: createPairingToken(),
  }
  writeSyncServerConfig(config)
  return config
}

/**
 * Records a library root, returning every root known afterwards. Roots
 * accumulate rather than replace: this host may serve several libraries at
 * once, and the blob store is shared across all of them.
 */
export function rememberLibraryRoot(url: string): string[] {
  const config = readSyncServerConfig()
  const knownRoots = config.knownRoots ?? []
  if (knownRoots.includes(url)) {
    return knownRoots
  }
  const next = [...knownRoots, url]
  writeSyncServerConfig({ ...config, knownRoots: next })
  return next
}

export function writeSyncServerConfig(config: SyncServerConfig) {
  writeFileSync(configFilePath(), JSON.stringify(config, null, 2))
}
